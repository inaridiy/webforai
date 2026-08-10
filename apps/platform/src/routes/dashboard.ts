import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthVariables } from "../auth/middleware";
import { requireSession } from "../auth/middleware";
import { FREE_MONTHLY_CREDITS } from "../billing/credits";
import { monthStart } from "../billing/guard";
import { createBillingRepo } from "../billing/repo";
import { createStripe } from "../billing/stripe";
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

/**
 * Session-authenticated dashboard API (mounted under `/api/dashboard`).
 *
 * The caller mounts `sessionMiddleware(auth)` before this sub-app; `requireSession` is
 * applied here so a mounting mistake cannot expose the routes anonymously.
 */
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

		const checkout = await stripe.checkout.sessions.create({
			mode: "subscription",
			customer,
			// Metered line items must not carry a quantity.
			line_items: [{ price: priceId }],
			success_url: `${config.BASE_URL}/dashboard?checkout=success`,
			cancel_url: `${config.BASE_URL}/dashboard?checkout=cancelled`,
		});

		return c.json({ url: checkout.url });
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

	return app;
};
