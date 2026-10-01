import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { deleteAccount } from "../account/delete-account";
import type { AuthVariables } from "../auth/middleware";
import { requireSession } from "../auth/middleware";
import { FREE_MONTHLY_CREDITS, monthlyCostUsd } from "../billing/credits";
import {
	DEFAULT_SPEND_CAP_USD,
	MAX_SPEND_CAP_USD,
	MIN_SPEND_CAP_USD,
	effectiveSpendCapUsd,
	monthStart,
	spendCapBodySchema,
} from "../billing/guard";
import { createBillingRepo } from "../billing/repo";
import { hasLiveSubscription } from "../billing/state";
import { createStripe } from "../billing/stripe";
import { reportToStripe } from "../billing/usage";
import { createDb } from "../db/client";
import { user } from "../db/schema";
import { loadConfig } from "../env";

type DashboardEnv = { Bindings: Env; Variables: AuthVariables };

/** Resolves the Stripe customer for the *session* user — never a client-supplied id. */
const customerIdOf = async (env: Env, userId: string): Promise<string | undefined> => {
	const db = createDb(env);
	const rows = await db
		.select({ stripeCustomerId: user.stripeCustomerId })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return rows[0]?.stripeCustomerId ?? undefined;
};

const spendCapResponse = (stored: number | null, monthCredits: number) => ({
	spendCapUsd: effectiveSpendCapUsd(stored),
	isDefault: stored === null,
	defaultUsd: DEFAULT_SPEND_CAP_USD,
	minUsd: MIN_SPEND_CAP_USD,
	maxUsd: MAX_SPEND_CAP_USD,
	monthCredits,
	estimatedUsd: monthlyCostUsd(monthCredits),
});

/**
 * Session-authenticated dashboard API (mounted under `/api/dashboard`).
 *
 * The caller mounts `sessionMiddleware(auth)` before this sub-app; `requireSession` is
 * applied here so a mounting mistake cannot expose the routes anonymously.
 */
const deleteAccountBody = z.object({ confirmEmail: z.string().min(1).max(320) });

const R2_LIST_LIMIT = 1000;

export const dashboardRoutes = () => {
	const app = new Hono<DashboardEnv>();

	app.use("*", requireSession);

	app.get("/usage", async (c) => {
		// biome-ignore lint/style/noNonNullAssertion: requireSession guarantees a user
		const sessionUser = c.get("user")!;
		const config = loadConfig(c.env);
		const repo = createBillingRepo(createDb(c.env));

		const [monthCredits, state, recentEvents] = await Promise.all([
			repo.sumMonthCredits(sessionUser.id, monthStart()),
			repo.getBillingState(sessionUser.id),
			repo.listRecentUsage(sessionUser.id, 50),
		]);

		return c.json({
			monthCredits,
			freeAllowance: FREE_MONTHLY_CREDITS,
			billingEnabled: config.billingEnabled,
			subscriptionStatus: state?.status ?? "none",
			currentPeriodEnd: state?.currentPeriodEnd?.toISOString() ?? null,
			recentEvents: recentEvents.map((event) => ({
				id: event.id,
				jobId: event.jobId,
				operation: event.operation,
				credits: event.credits,
				createdAt: event.createdAt.toISOString(),
				reported: event.reportedAt !== null,
			})),
		});
	});

	app.post("/billing/checkout", async (c) => {
		// biome-ignore lint/style/noNonNullAssertion: requireSession guarantees a user
		const sessionUser = c.get("user")!;
		const config = loadConfig(c.env);
		const stripe = createStripe(config);
		const priceId = config.STRIPE_METERED_PRICE_ID;
		if (!(stripe && priceId)) {
			return c.json({ error: { code: "billing_disabled", message: "Billing is not configured." } }, 409);
		}
		const customer = await customerIdOf(c.env, sessionUser.id);
		if (!customer) {
			return c.json({ error: { code: "no_customer", message: "No Stripe customer for this account." } }, 409);
		}

		// The local mirror first (cheap), then Stripe itself: the mirror lags its webhooks, and a
		// second subscription would bill the same metered usage twice.
		const state = await createBillingRepo(createDb(c.env)).getBillingState(sessionUser.id);
		const live =
			hasLiveSubscription(state) ||
			hasLiveSubscription((await stripe.subscriptions.list({ customer, status: "all", limit: 10 })).data);
		if (live) {
			return c.json(
				{
					error: {
						code: "already_subscribed",
						message: "This account already has a subscription. Manage it from the billing portal.",
					},
				},
				409,
			);
		}

		const checkout = await stripe.checkout.sessions.create({
			mode: "subscription",
			customer,
			// Metered line items must not carry a quantity.
			line_items: [{ price: priceId }],
			subscription_data: {
				// Periods run 1st→1st (00:00 UTC), matching the UTC calendar month the spend guard,
				// free allowance and dashboard estimate count — so Stripe's graduated tiers reset
				// when ours do. The first period is the short stub up to the next 1st; a metered
				// price has no fixed fee to prorate.
				billing_cycle_anchor_config: { day_of_month: 1, hour: 0, minute: 0, second: 0 },
				proration_behavior: "none",
			},
			success_url: `${config.BASE_URL}/dashboard?checkout=success`,
			cancel_url: `${config.BASE_URL}/dashboard?checkout=cancelled`,
		});

		return c.json({ url: checkout.url });
	});

	/** The monthly spend cap and what this UTC month is estimated to cost so far. */
	app.get("/billing/spend-cap", async (c) => {
		// biome-ignore lint/style/noNonNullAssertion: requireSession guarantees a user
		const sessionUser = c.get("user")!;
		const repo = createBillingRepo(createDb(c.env));
		const [state, monthCredits] = await Promise.all([
			repo.getBillingState(sessionUser.id),
			repo.sumMonthCredits(sessionUser.id, monthStart()),
		]);
		return c.json(spendCapResponse(state?.spendCapUsd ?? null, monthCredits));
	});

	app.put("/billing/spend-cap", async (c) => {
		// biome-ignore lint/style/noNonNullAssertion: requireSession guarantees a user
		const sessionUser = c.get("user")!;
		const body = spendCapBodySchema.safeParse(await c.req.json().catch(() => null));
		if (!body.success) {
			return c.json(
				{
					error: {
						code: "invalid_request",
						message: `Send { spendCapUsd }: a whole number of dollars from ${MIN_SPEND_CAP_USD} to ${MAX_SPEND_CAP_USD}.`,
					},
				},
				400,
			);
		}
		const repo = createBillingRepo(createDb(c.env));
		await repo.setSpendCap(sessionUser.id, body.data.spendCapUsd, new Date());
		const monthCredits = await repo.sumMonthCredits(sessionUser.id, monthStart());
		return c.json(spendCapResponse(body.data.spendCapUsd, monthCredits));
	});

	app.post("/billing/portal", async (c) => {
		// biome-ignore lint/style/noNonNullAssertion: requireSession guarantees a user
		const sessionUser = c.get("user")!;
		const config = loadConfig(c.env);
		const stripe = createStripe(config);
		if (!stripe) {
			return c.json({ error: { code: "billing_disabled", message: "Billing is not configured." } }, 409);
		}
		const customer = await customerIdOf(c.env, sessionUser.id);
		if (!customer) {
			return c.json({ error: { code: "no_customer", message: "No Stripe customer for this account." } }, 409);
		}

		const portal = await stripe.billingPortal.sessions.create({
			customer,
			return_url: `${config.BASE_URL}/dashboard`,
		});

		return c.json({ url: portal.url });
	});

	/**
	 * Deletes the signed-in account and its data (`src/account/delete-account.ts`). The body
	 * must repeat the account's email; billing is settled first and a billing failure deletes
	 * nothing.
	 */
	app.post("/account/delete", async (c) => {
		// biome-ignore lint/style/noNonNullAssertion: requireSession guarantees a user
		const sessionUser = c.get("user")!;
		const body = deleteAccountBody.safeParse(await c.req.json().catch(() => null));
		if (!body.success) {
			return c.json({ error: { code: "invalid_request", message: "Send { confirmEmail }." } }, 400);
		}
		const config = loadConfig(c.env);
		const db = createDb(c.env);
		const stripe = createStripe(config);
		const usageDeps = { repo: createBillingRepo(db), config, stripe };
		await deleteAccount(
			{
				db,
				billing:
					config.billingEnabled && stripe
						? {
								report: (row) => reportToStripe(usageDeps, row),
								cancelSubscription: async (id) => {
									// Final invoice now, including metered usage so far.
									await stripe.subscriptions.cancel(id, { invoice_now: true, prorate: false });
								},
							}
						: undefined,
				deletePrefix: async (prefix) => {
					let cursor: string | undefined;
					do {
						const listed = await c.env.ARTIFACTS.list({ prefix, limit: R2_LIST_LIMIT, ...(cursor ? { cursor } : {}) });
						if (listed.objects.length > 0) {
							await c.env.ARTIFACTS.delete(listed.objects.map((object) => object.key));
						}
						cursor = listed.truncated ? listed.cursor : undefined;
					} while (cursor);
				},
				terminateWorkflow: async (instanceId) => {
					await (await c.env.CRAWL_WORKFLOW.get(instanceId)).terminate();
				},
				waitUntil: (promise) => c.executionCtx.waitUntil(promise),
			},
			{ id: sessionUser.id, email: sessionUser.email },
			body.data.confirmEmail,
		);
		return c.json({ deleted: true });
	});

	return app;
};
