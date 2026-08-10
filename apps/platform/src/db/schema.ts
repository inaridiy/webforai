/**
 * D1 schema. Auth tables (user/session/account/verification/apikey/subscription) are
 * generated from the Better Auth config (`npx auth generate`) and live in ./auth-schema.ts;
 * this file adds the platform's own tables and re-exports everything for drizzle-kit.
 */
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
	(table) => [index("jobs_user_idx").on(table.userId, table.createdAt)],
);

export const usageEvents = sqliteTable(
	"usage_events",
	{
		/** ULID; doubles as the Stripe meter-event `identifier` for idempotency. */
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		jobId: text("job_id"),
		operation: text("operation").notNull(),
		credits: integer("credits").notNull(),
		/** Set once the Stripe meter event is acknowledged; unsent rows are retried. */
		reportedAt: integer("reported_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [index("usage_user_idx").on(table.userId, table.createdAt)],
);
