import { and, desc, eq, gt, gte, isNotNull, isNull, lt, min, notExists, or, sql } from "drizzle-orm";
import type { PlatformDb } from "../db/client";
import { usageEvents, user } from "../db/schema";
import { type BillingState, getBillingState, setSpendCap } from "./state";

export interface UsageEventRow {
	id: string;
	userId: string;
	jobId: string | null;
	operation: string;
	credits: number;
	createdAt: Date;
	reportedAt: Date | null;
	reportSkippedReason?: "no_customer" | "expired" | null;
}

/** A row still owed to Stripe, joined with the customer it must be reported for. */
export interface UnreportedUsage {
	id: string;
	userId: string;
	credits: number;
	createdAt: Date;
	stripeCustomerId: string;
}

/** Keyset position in the pending-report queue (ordered by `createdAt`, then `id`). */
export interface UsageCursor {
	createdAt: Date;
	id: string;
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
	/**
	 * Pending rows of users who have a Stripe customer, oldest first, strictly after `after`.
	 * Rows marked skipped are excluded.
	 */
	listUnreported(limit: number, after?: UsageCursor): Promise<UnreportedUsage[]>;
	/** Takes pending rows of customerless users out of the queue; returns how many. */
	skipCustomerless(): Promise<number>;
	/** Takes pending rows created before `before` out of the queue; returns their credits. */
	skipExpired(before: Date): Promise<{ id: string; credits: number }[]>;
	/** Pending billable rows created before `before`: how many, and the oldest; none → undefined. */
	pendingBacklog(before: Date): Promise<{ count: number; oldest: Date } | undefined>;
	setSpendCap(userId: string, spendCapUsd: number, now: Date): Promise<void>;
	listRecentUsage(userId: string, limit: number): Promise<UsageEventRow[]>;
}

/** Rows still owed to Stripe — the `usage_pending_report_idx` predicate. */
const pending = and(isNull(usageEvents.reportedAt), isNull(usageEvents.reportSkippedReason));

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

	listUnreported: async (limit, after) => {
		// Same predicate as `usage_pending_report_idx`, so the partial index serves the scan.
		const rows = await db
			.select({
				id: usageEvents.id,
				userId: usageEvents.userId,
				credits: usageEvents.credits,
				createdAt: usageEvents.createdAt,
				stripeCustomerId: user.stripeCustomerId,
			})
			.from(usageEvents)
			.innerJoin(user, eq(user.id, usageEvents.userId))
			.where(
				and(
					pending,
					isNotNull(user.stripeCustomerId),
					after
						? or(
								gt(usageEvents.createdAt, after.createdAt),
								and(eq(usageEvents.createdAt, after.createdAt), gt(usageEvents.id, after.id)),
							)
						: undefined,
				),
			)
			.orderBy(usageEvents.createdAt, usageEvents.id)
			.limit(limit);
		return rows.flatMap((row) => (row.stripeCustomerId ? [{ ...row, stripeCustomerId: row.stripeCustomerId }] : []));
	},

	skipCustomerless: async () => {
		const rows = await db
			.update(usageEvents)
			.set({ reportSkippedReason: "no_customer" })
			.where(
				and(
					pending,
					notExists(
						db
							.select({ id: user.id })
							.from(user)
							.where(and(eq(user.id, usageEvents.userId), isNotNull(user.stripeCustomerId))),
					),
				),
			)
			.returning({ id: usageEvents.id });
		return rows.length;
	},

	skipExpired: async (before) =>
		db
			.update(usageEvents)
			.set({ reportSkippedReason: "expired" })
			.where(and(pending, lt(usageEvents.createdAt, before)))
			.returning({ id: usageEvents.id, credits: usageEvents.credits }),

	pendingBacklog: async (before) => {
		const rows = await db
			.select({ count: sql<number>`count(*)`, oldest: min(usageEvents.createdAt) })
			.from(usageEvents)
			.innerJoin(user, eq(user.id, usageEvents.userId))
			.where(and(pending, isNotNull(user.stripeCustomerId), lt(usageEvents.createdAt, before)));
		const row = rows[0];
		if (!(row?.oldest && Number(row.count) > 0)) return undefined;
		return { count: Number(row.count), oldest: row.oldest };
	},

	setSpendCap: (userId, spendCapUsd, now) => setSpendCap(db, userId, spendCapUsd, now),

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
