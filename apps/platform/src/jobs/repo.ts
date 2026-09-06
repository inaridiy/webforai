import { and, desc, eq, notInArray } from "drizzle-orm";
import type { PlatformDb } from "../db/client";
import { jobs } from "../db/schema";

/**
 * D1 access for async jobs.
 *
 * Page counters and usage are committed atomically by `page-accounting.ts`.
 * Status transitions are monotonic — once a job is `completed`/`failed` nothing rewrites it,
 * which keeps a late-arriving retry from resurrecting a terminal job.
 */

export type JobType = "batch" | "crawl";
export type JobStatus = "queued" | "running" | "completed" | "failed";

/** Statuses that no further update may move away from. */
const TERMINAL_STATUSES: JobStatus[] = ["completed", "failed"];

export interface JobRow {
	id: string;
	userId: string;
	type: JobType;
	status: JobStatus;
	request: unknown;
	total: number;
	succeeded: number;
	failed: number;
	creditsUsed: number;
	workflowInstanceId: string | null;
	error: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreateJobParams {
	id: string;
	userId: string;
	type: JobType;
	/** The validated request body, stored verbatim for reproducibility and the dashboard. */
	request: unknown;
	/** Known before scheduling because the caller chooses the Workflow instance id. */
	workflowInstanceId?: string;
	/** Known upfront for batch; a crawl discovers its pages and grows this as it runs. */
	total?: number;
	now?: Date;
}

export interface UpdateStatusPatch {
	error?: string | null;
	workflowInstanceId?: string | null;
	total?: number;
	now?: Date;
}

export interface JobsRepo {
	createJob(params: CreateJobParams): Promise<JobRow>;
	/** Scoped by owner: a job id from another account must be indistinguishable from a missing one. */
	getJob(id: string, userId: string): Promise<JobRow | undefined>;
	updateStatus(id: string, status: JobStatus, patch?: UpdateStatusPatch): Promise<void>;
	listJobsByUser(userId: string, limit?: number): Promise<JobRow[]>;
}

export const DEFAULT_JOB_LIST_LIMIT = 50;

export const createJobsRepo = (db: PlatformDb): JobsRepo => ({
	createJob: async (params) => {
		const now = params.now ?? new Date();
		const row: JobRow = {
			id: params.id,
			userId: params.userId,
			type: params.type,
			status: "queued",
			request: params.request,
			total: params.total ?? 0,
			succeeded: 0,
			failed: 0,
			creditsUsed: 0,
			workflowInstanceId: params.workflowInstanceId ?? null,
			error: null,
			createdAt: now,
			updatedAt: now,
		};
		await db.insert(jobs).values(row);
		return row;
	},

	getJob: async (id, userId) => {
		const rows = await db
			.select()
			.from(jobs)
			.where(and(eq(jobs.id, id), eq(jobs.userId, userId)))
			.limit(1);
		return rows[0];
	},

	updateStatus: async (id, status, patch = {}) => {
		await db
			.update(jobs)
			.set({
				status,
				updatedAt: patch.now ?? new Date(),
				...(patch.error === undefined ? {} : { error: patch.error }),
				...(patch.workflowInstanceId === undefined ? {} : { workflowInstanceId: patch.workflowInstanceId }),
				...(patch.total === undefined ? {} : { total: patch.total }),
			})
			.where(
				and(
					eq(jobs.id, id),
					status === "queued" ? eq(jobs.status, "queued") : notInArray(jobs.status, TERMINAL_STATUSES),
				),
			);
	},

	listJobsByUser: async (userId, limit = DEFAULT_JOB_LIST_LIMIT) => {
		const rows = await db.select().from(jobs).where(eq(jobs.userId, userId)).orderBy(desc(jobs.createdAt)).limit(limit);
		return rows;
	},
});
