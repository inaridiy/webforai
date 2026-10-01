/**
 * D1 schema. Auth tables (user/session/account/verification/apikey/subscription) are
 * generated from the Better Auth config (`npx auth generate`) and live in ./auth-schema.ts;
 * this file adds the platform's own tables and re-exports everything for drizzle-kit.
 */
import { and, isNull } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export * from "./auth-schema";

export const jobs = sqliteTable(
	"jobs",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		type: text("type", { enum: ["batch", "crawl"] }).notNull(),
		status: text("status", { enum: ["queued", "running", "completed", "failed"] }).notNull(),
		/** Original request body (validated), for reproducibility and the dashboard. */
		request: text("request", { mode: "json" }).notNull(),
		total: integer("total").notNull().default(0),
		succeeded: integer("succeeded").notNull().default(0),
		failed: integer("failed").notNull().default(0),
		creditsUsed: integer("credits_used").notNull().default(0),
		workflowInstanceId: text("workflow_instance_id"),
		error: text("error"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		index("jobs_user_idx").on(table.userId, table.createdAt),
		// Per-user concurrency limit: counts a user's queued/running jobs on every job submission.
		index("jobs_user_status_idx").on(table.userId, table.status),
	],
);

/** Immutable page commits. Full results and crawl links live in the referenced R2 object. */
export const jobPages = sqliteTable(
	"job_pages",
	{
		id: text("id").primaryKey(),
		jobId: text("job_id")
			.notNull()
			.references(() => jobs.id, { onDelete: "cascade" }),
		pageIndex: integer("page_index").notNull(),
		resultKey: text("result_key").notNull(),
		status: text("status", { enum: ["ok", "error"] }).notNull(),
		engine: text("engine").notNull(),
		credits: integer("credits").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [uniqueIndex("job_pages_job_index").on(table.jobId, table.pageIndex)],
);

/**
 * Mirror of the Stripe subscription state for the metered price.
 *
 * The Better Auth stripe plugin only models *fixed* plans, so its `subscription` table is
 * not enabled here (see docs/specs/platform/04_billing.md); this table is the local,
 * hot-path-readable truth kept in sync by the plugin's `onEvent` webhook callback.
 */
export const billingState = sqliteTable("billing_state", {
	/** Better Auth `user.id`. */
	userId: text("user_id").primaryKey(),
	stripeCustomerId: text("stripe_customer_id"),
	status: text("status", { enum: ["none", "active", "past_due", "canceled"] })
		.notNull()
		.default("none"),
	stripeSubscriptionId: text("stripe_subscription_id"),
	currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
	/**
	 * User-set monthly spend cap in whole US dollars; `null` means the default
	 * (`DEFAULT_SPEND_CAP_USD` in `src/billing/guard.ts`). Written only by the dashboard, never by
	 * the webhook mirror, so a subscription event cannot reset it.
	 */
	spendCapUsd: integer("spend_cap_usd"),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const usageEvents = sqliteTable(
	"usage_events",
	{
		/** ULID for sync requests, deterministic page id for jobs; also Stripe's meter identifier. */
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		jobId: text("job_id"),
		operation: text("operation").notNull(),
		credits: integer("credits").notNull(),
		/** Set once the Stripe meter event is acknowledged; unsent rows are retried. */
		reportedAt: integer("reported_at", { mode: "timestamp" }),
		/**
		 * Why an unsent row will never be sent: its user has no Stripe customer (free usage on a
		 * customerless account), or it is older than the meter accepts (35 days). Such rows leave
		 * the retry queue instead of blocking it; `reportedAt` stays null so they are never
		 * mistaken for billed usage.
		 */
		reportSkippedReason: text("report_skipped_reason", { enum: ["no_customer", "expired"] }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		index("usage_user_idx").on(table.userId, table.createdAt),
		// The 15-minute Stripe report cron reads pending rows oldest-first (keyset on created_at,
		// id); without this partial index every run scans the whole ledger. Only rows still owed
		// to Stripe are in it, so it stays small.
		index("usage_pending_report_idx")
			.on(table.createdAt, table.id)
			// biome-ignore lint/style/noNonNullAssertion: `and` of two conditions is never undefined
			.where(and(isNull(table.reportedAt), isNull(table.reportSkippedReason))!),
	],
);
