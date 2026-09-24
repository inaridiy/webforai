import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { PlatformError } from "../core/types";
import type { PlatformDb } from "../db/client";
import { account, apikey, billingState, jobPages, jobs, session, usageEvents, user, verification } from "../db/schema";

/**
 * Account deletion, owner-requested and user-triggered from the dashboard.
 *
 * Billing is settled first and any billing failure aborts before a single row is deleted:
 *   1. usage rows not yet on the Stripe meter are reported, so nothing owed is lost;
 *   2. an active subscription is cancelled with an immediate final invoice.
 * Then the user's rows go in one D1 batch (keys, jobs + pages, usage, billing state, pending
 * sign-in codes, sessions, linked accounts, the user). Stripe keeps its invoices and customer
 * record — the billing records the privacy policy says are retained. Job result archives in
 * R2 are removed best-effort afterwards; anything missed expires under the 7-day lifecycle.
 */

export interface DeleteAccountBilling {
	/** Reports one unreported usage row to the meter (and marks it reported). */
	report(row: { id: string; stripeCustomerId: string; credits: number }): Promise<void>;
	/** Cancels a subscription now, invoicing outstanding metered usage. */
	cancelSubscription(subscriptionId: string): Promise<void>;
}

export interface DeleteAccountDeps {
	db: PlatformDb;
	/** Absent when billing is not configured on this deployment. */
	billing?: DeleteAccountBilling | undefined;
	/** Best-effort removal of stored objects under a key prefix. */
	deletePrefix?: ((prefix: string) => Promise<void>) | undefined;
	waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
}

const SUBSCRIBED = new Set(["active", "past_due"]);

const settleBilling = async (deps: DeleteAccountDeps, userId: string, customerId: string | null): Promise<void> => {
	const { billing } = deps;
	if (!billing) {
		return;
	}
	const state = (await deps.db.select().from(billingState).where(eq(billingState.userId, userId)))[0];
	const stripeCustomerId = state?.stripeCustomerId ?? customerId;
	if (stripeCustomerId) {
		const unreported = await deps.db
			.select({ id: usageEvents.id, credits: usageEvents.credits })
			.from(usageEvents)
			.where(and(eq(usageEvents.userId, userId), isNull(usageEvents.reportedAt)));
		try {
			for (const row of unreported) {
				await billing.report({ id: row.id, stripeCustomerId, credits: row.credits });
			}
		} catch {
			throw new PlatformError(
				"billing_unavailable",
				"Your latest usage could not be sent to billing, so the account was not deleted. Try again in a few minutes.",
				503,
			);
		}
	}
	if (state?.stripeSubscriptionId && SUBSCRIBED.has(state.status)) {
		try {
			await billing.cancelSubscription(state.stripeSubscriptionId);
		} catch {
			throw new PlatformError(
				"billing_unavailable",
				"The subscription could not be cancelled, so the account was not deleted. Try again in a few minutes.",
				503,
			);
		}
	}
};

export const deleteAccount = async (
	deps: DeleteAccountDeps,
	target: { id: string; email: string },
	confirmEmail: string,
): Promise<void> => {
	if (confirmEmail.trim().toLowerCase() !== target.email.toLowerCase()) {
		throw new PlatformError("invalid_request", "Type your account's email address exactly to confirm.", 400);
	}
	const row = (await deps.db.select().from(user).where(eq(user.id, target.id)))[0];
	if (!row) {
		throw new PlatformError("not_found", "The account no longer exists.", 404);
	}

	await settleBilling(deps, target.id, row.stripeCustomerId ?? null);

	const jobIds = (await deps.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.userId, target.id))).map(
		(job) => job.id,
	);
	const email = row.email.toLowerCase();
	await deps.db.batch([
		deps.db.delete(apikey).where(eq(apikey.referenceId, target.id)),
		// A subquery, not the id list: D1 caps bound parameters at 100 per statement.
		deps.db
			.delete(jobPages)
			.where(inArray(jobPages.jobId, deps.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.userId, target.id)))),
		deps.db.delete(jobs).where(eq(jobs.userId, target.id)),
		deps.db.delete(usageEvents).where(eq(usageEvents.userId, target.id)),
		deps.db.delete(billingState).where(eq(billingState.userId, target.id)),
		deps.db
			.delete(verification)
			.where(
				or(
					eq(verification.identifier, `sign-in-otp-${email}`),
					eq(verification.identifier, `email-verification-otp-${email}`),
				),
			),
		deps.db.delete(session).where(eq(session.userId, target.id)),
		deps.db.delete(account).where(eq(account.userId, target.id)),
		deps.db.delete(user).where(eq(user.id, target.id)),
	]);

	if (deps.deletePrefix && jobIds.length > 0) {
		const { deletePrefix } = deps;
		const cleanup = Promise.allSettled(jobIds.map((id) => deletePrefix(`results/job-pages/${id}/`)));
		if (deps.waitUntil) {
			deps.waitUntil(cleanup);
		} else {
			await cleanup;
		}
	}
};
