import { and, asc, eq, gt, notExists, sql } from "drizzle-orm";
import type { PlatformDb } from "../db/client";
import { jobPages, jobs, usageEvents } from "../db/schema";

export type PageCommit = typeof jobPages.$inferSelect;

export const pageCommitId = (jobId: string, index: number): string => `${jobId}:page:${index}`;

export interface CommitPageParams {
	page: PageCommit;
	userId: string;
	countsTowardsTotal: boolean;
}

export interface PageAccountingRepo {
	get(id: string): Promise<PageCommit | undefined>;
	hasPages(jobId: string): Promise<boolean>;
	list(jobId: string, afterIndex: number, limit: number, createdAfter: Date): Promise<PageCommit[]>;
	/** Atomically commits marker, counters, and successful usage; returns the first writer. */
	commit(params: CommitPageParams): Promise<PageCommit>;
}

export const createPageAccountingRepo = (db: PlatformDb): PageAccountingRepo => {
	const get = async (id: string) => (await db.select().from(jobPages).where(eq(jobPages.id, id)).limit(1))[0];
	return {
		get,
		hasPages: async (jobId) =>
			(await db.select({ id: jobPages.id }).from(jobPages).where(eq(jobPages.jobId, jobId)).limit(1)).length > 0,
		list: (jobId, afterIndex, limit, createdAfter) =>
			db
				.select()
				.from(jobPages)
				.where(and(eq(jobPages.jobId, jobId), gt(jobPages.pageIndex, afterIndex), gt(jobPages.createdAt, createdAfter)))
				.orderBy(asc(jobPages.pageIndex))
				.limit(limit),
		commit: async ({ page, userId, countsTowardsTotal }) => {
			if (
				page.id !== pageCommitId(page.jobId, page.pageIndex) ||
				!Number.isSafeInteger(page.pageIndex) ||
				page.pageIndex < 0
			) {
				throw new Error("Invalid page accounting identity.");
			}
			if (!Number.isSafeInteger(page.credits) || page.credits < 0 || (page.status === "error" && page.credits !== 0)) {
				throw new Error("Invalid page accounting credits.");
			}
			const absent = notExists(db.select({ id: jobPages.id }).from(jobPages).where(eq(jobPages.id, page.id)));
			const increment = db
				.update(jobs)
				.set({
					succeeded: sql`${jobs.succeeded} + ${page.status === "ok" ? 1 : 0}`,
					failed: sql`${jobs.failed} + ${page.status === "error" ? 1 : 0}`,
					creditsUsed: sql`${jobs.creditsUsed} + ${page.credits}`,
					total: sql`${jobs.total} + ${countsTowardsTotal ? 1 : 0}`,
					updatedAt: page.createdAt,
				})
				.where(and(eq(jobs.id, page.jobId), eq(jobs.userId, userId), absent));
			const marker = db
				.insert(jobPages)
				.select(
					db
						.select({
							id: sql<string>`${page.id}`.as("id"),
							jobId: sql<string>`${page.jobId}`.as("jobId"),
							pageIndex: sql<number>`${page.pageIndex}`.as("pageIndex"),
							resultKey: sql<string>`${page.resultKey}`.as("resultKey"),
							status: sql`${page.status}`.as("status"),
							engine: sql<string>`${page.engine}`.as("engine"),
							credits: sql<number>`${page.credits}`.as("credits"),
							createdAt: sql`${Math.floor(page.createdAt.getTime() / 1000)}`.as("createdAt"),
						})
						.from(jobs)
						.where(and(eq(jobs.id, page.jobId), eq(jobs.userId, userId))),
				)
				.onConflictDoNothing();
			if (page.status === "ok") {
				const usage = db
					.insert(usageEvents)
					.select(
						db
							.select({
								id: sql<string>`${page.id}`.as("id"),
								userId: sql<string>`${userId}`.as("userId"),
								jobId: sql<string>`${page.jobId}`.as("jobId"),
								operation: sql<string>`${page.engine}`.as("operation"),
								credits: sql<number>`${page.credits}`.as("credits"),
								reportedAt: sql`null`.as("reportedAt"),
								createdAt: sql`${Math.floor(page.createdAt.getTime() / 1000)}`.as("createdAt"),
							})
							.from(jobs)
							.where(and(eq(jobs.id, page.jobId), eq(jobs.userId, userId), absent)),
					)
					.onConflictDoNothing();
				await db.batch([usage, increment, marker]);
			} else {
				await db.batch([increment, marker]);
			}
			// D1 batches are serialized transactions. Keeping the marker last means all prior
			// writes share the same absence guard and a failed marker rolls them all back.
			const committed = await get(page.id);
			if (!committed) throw new Error("Page commit was not persisted.");
			return committed;
		},
	};
};
