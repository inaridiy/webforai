import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { PlatformDb } from "../db/client";
import { usageEvents, user } from "../db/schema";
import { type BillingState, getBillingState } from "./state";

export interface UsageEventRow {
	id: string;
	userId: string;
	jobId: string | null;
	operation: string;
	credits: number;
	createdAt: Date;
	reportedAt: Date | null;
}

/** A row still owed to Stripe, joined with the customer it must be reported for. */
export interface UnreportedUsage {
	id: string;
	userId: string;
	credits: number;
	stripeCustomerId: string | null;
}

/**
 * The only database surface the billing logic touches.
 *
 * D1 has no in-process test double, so guard/usage are written against this interface and
 * unit-tested with a plain object; `createBillingRepo` is the single drizzle implementation.
 */
export interface BillingRepo {
	getBillingState(userId: string): Promise<BillingState | undefined>;
	/** Sum of credits recorded at or after `since` (used for the calendar-month allowance). */
	sumMonthCredits(userId: string, since: Date): Promise<number>;
	insertUsage(row: UsageEventRow): Promise<void>;
	markReported(id: string, reportedAt: Date): Promise<void>;
	listUnreported(limit: number): Promise<UnreportedUsage[]>;
	listRecentUsage(userId: string, limit: number): Promise<UsageEventRow[]>;
}

export const createBillingRepo = (db: PlatformDb): BillingRepo => ({
	getBillingState: (userId) => getBillingState(db, userId),

	sumMonthCredits: async (userId, since) => {
		const rows = await db
			.select({ total: sql<number>`coalesce(sum(${usageEvents.credits}), 0)` })
			.from(usageEvents)
			.where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, since)));
		return Number(rows[0]?.total ?? 0);
	},

	insertUsage: async (row) => {
		await db.insert(usageEvents).values(row).onConflictDoNothing();
	},

	markReported: async (id, reportedAt) => {
		await db.update(usageEvents).set({ reportedAt }).where(eq(usageEvents.id, id));
	},

	listUnreported: async (limit) => {
		const rows = await db
			.select({
				id: usageEvents.id,
				userId: usageEvents.userId,
				credits: usageEvents.credits,
				stripeCustomerId: user.stripeCustomerId,
			})
			.from(usageEvents)
			.leftJoin(user, eq(user.id, usageEvents.userId))
			.where(isNull(usageEvents.reportedAt))
			.orderBy(usageEvents.createdAt)
			.limit(limit);
		return rows.map((row) => ({ ...row, stripeCustomerId: row.stripeCustomerId ?? null }));
	},

	listRecentUsage: async (userId, limit) => {
		const rows = await db
			.select()
			.from(usageEvents)
			.where(eq(usageEvents.userId, userId))
			.orderBy(desc(usageEvents.createdAt))
			.limit(limit);
		return rows;
	},
});
