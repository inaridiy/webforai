import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { isReportableAge } from "../billing/usage";
import { PlatformError } from "../core/types";
import type { PlatformDb } from "../db/client";
import { account, apikey, billingState, jobPages, jobs, session, usageEvents, user, verification } from "../db/schema";

/**
 * Account deletion, owner-requested and user-triggered from the dashboard.
 *
 * The user's queued/running job Workflows are terminated first (best-effort, so a job cannot
 * keep scraping — and recording usage — for an account being deleted). Then billing is settled,
 * and any billing failure aborts before a single row is deleted:
 *   1. usage rows not yet on the Stripe meter are reported, so nothing owed is lost;
 *   2. an active subscription is cancelled with an immediate final invoice.
 * Finally the user's rows go in one D1 batch (keys, jobs + pages, usage, billing state, pending
 * sign-in codes, sessions, linked accounts, the user). Stripe keeps its invoices and customer
 * record — the billing records the privacy policy says are retained. Job result archives in
 * R2 are removed best-effort afterwards; anything missed expires under the 7-day lifecycle.
 */

export interface DeleteAccountBilling {
	/** Reports one unreported usage row to the meter (and marks it reported). */
	report(row: { id: string; stripeCustomerId: string; credits: number; createdAt: Date }): Promise<void>;
	/** Cancels a subscription now, invoicing outstanding metered usage. */
	cancelSubscription(subscriptionId: string): Promise<void>;
}

export interface DeleteAccountDeps {
	db: PlatformDb;
	/** Absent when billing is not configured on this deployment. */
	billing?: DeleteAccountBilling | undefined;
	/** Best-effort removal of stored objects under a key prefix. */
	deletePrefix?: ((prefix: string) => Promise<void>) | undefined;
	/** Best-effort termination of a job's Workflow instance. */
	terminateWorkflow?: ((instanceId: string) => Promise<void>) | undefined;
	waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
	now?: (() => Date) | undefined;
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
			.select({ id: usageEvents.id, credits: usageEvents.credits, createdAt: usageEvents.createdAt })
			.from(usageEvents)
			.where(
				and(eq(usageEvents.userId, userId), isNull(usageEvents.reportedAt), isNull(usageEvents.reportSkippedReason)),
			);
		const now = deps.now?.() ?? new Date();
		try {
			// Rows past the meter's 35-day window would be rejected forever and block deletion.
			for (const row of unreported.filter((usage) => isReportableAge(usage.createdAt, now))) {
				await billing.report({ id: row.id, stripeCustomerId, credits: row.credits, createdAt: row.createdAt });
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

	const userJobs = await deps.db
		.select({ id: jobs.id, status: jobs.status, workflowInstanceId: jobs.workflowInstanceId })
		.from(jobs)
		.where(eq(jobs.userId, target.id));
	const jobIds = userJobs.map((job) => job.id);

	if (deps.terminateWorkflow) {
		const { terminateWorkflow } = deps;
		const live = userJobs.filter(
			(job) => job.workflowInstanceId && (job.status === "queued" || job.status === "running"),
		);
		const results = await Promise.allSettled(live.map((job) => terminateWorkflow(job.workflowInstanceId as string)));
		const failed = results.filter((result) => result.status === "rejected").length;
		if (failed > 0) {
			// Instances that finished meanwhile reject too; anything left expires with its job row gone.
			console.warn("account_delete_terminate_failed", { userId: target.id, failed });
		}
	}

	// After the jobs stop, so no page can record usage between the final report and the delete.
	await settleBilling(deps, target.id, row.stripeCustomerId ?? null);
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
