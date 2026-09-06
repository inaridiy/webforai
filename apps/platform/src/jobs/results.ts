import type { ArtifactStore } from "../artifacts/store";
import { createArtifactStore } from "../artifacts/store";
import type { RequestedEngine, ScrapeSuccess } from "../core/types";
import type { AppConfig } from "../env";
import type { JobStatus, JobType } from "./repo";

/**
 * Per-page job results in KV.
 *
 * Keys are `job:<id>:<n>` with `n` zero-padded to 5 digits, because KV `list` is
 * lexicographic: unpadded indexes would order 10 before 2. The job's own snapshot lives at
 * `job:<id>:meta` and is filtered out of page listings (it shares the page prefix, and "m"
 * sorts after every digit, so it would otherwise appear as a phantom last page).
 *
 * Values are capped: a KV value may be 25 MiB, but a converted page that large would make the
 * results endpoint unusable, so anything over `MAX_INLINE_RESULT_BYTES` is written to R2 and
 * replaced in KV by a small `{ resultUrl }` stub.
 */

export const JOB_RESULT_TTL_SECONDS = 7 * 24 * 60 * 60;
/** KV rejects `expirationTtl` below 60s. */
const MIN_KV_TTL_SECONDS = 60;
export const MAX_INLINE_RESULT_BYTES = 100 * 1024;
export const PAGE_INDEX_DIGITS = 5;
export const DEFAULT_RESULTS_PAGE_SIZE = 20;

export const pageResultKey = (jobId: string, index: number): string =>
	`job:${jobId}:${String(index).padStart(PAGE_INDEX_DIGITS, "0")}`;

export const jobMetaKey = (jobId: string): string => `job:${jobId}:meta`;

export const jobKeyPrefix = (jobId: string): string => `job:${jobId}:`;

export interface PageError {
	code: string;
	message: string;
}

/** A page that converted successfully — the sync scrape response plus a status discriminator. */
export type PageSuccess = ScrapeSuccess & { status: "ok" };

/** A page that failed. Failed pages are recorded but never billed. */
export interface PageFailure {
	status: "error";
	url: string;
	/** As requested — a failed `auto` page never resolved to a concrete engine. */
	engine: RequestedEngine;
	error: PageError;
}

export type PageResult = PageSuccess | PageFailure;

/** What a listing returns: the stored result, or a pointer to the R2 copy of an oversized one. */
export type StoredPageResult =
	| PageResult
	| { status: "ok"; url: string; engine: RequestedEngine; credits: number; resultUrl: string };

export interface JobMeta {
	jobId: string;
	type: JobType;
	status: JobStatus;
	total: number;
	completed: number;
	failed: number;
	credits: number;
	error?: string | null;
	updatedAt: string;
}

/**
 * The slice of KV this module uses.
 *
 * Injected rather than taken from `Env` so the paging/padding logic is unit-testable with a
 * Map-backed stub — no miniflare, no Cloudflare runtime.
 */
export interface JobKv {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
	list(options: { prefix: string; limit?: number; cursor?: string }): Promise<{
		keys: { name: string }[];
		list_complete: boolean;
		cursor?: string;
	}>;
}

export interface JobResultsDeps {
	kv: JobKv;
	artifacts: ArtifactStore;
}

/** Composition root: the real bindings behind the two injected interfaces. */
export const createJobResultsDeps = (env: Env, config: AppConfig): JobResultsDeps => ({
	kv: env.JOBS_KV,
	artifacts: createArtifactStore(env, config),
});

const encoder = new TextEncoder();

const ttlOf = (ttlSeconds: number): number => Math.max(ttlSeconds, MIN_KV_TTL_SECONDS);

/**
 * Persists one page result. Oversized results spill to R2 with an expiring URL, so the KV value
 * — and therefore every `results` page — stays small enough to serve.
 */
export const putPageResult = async (
	deps: JobResultsDeps,
	jobId: string,
	index: number,
	result: PageResult,
	ttlSeconds: number = JOB_RESULT_TTL_SECONDS,
): Promise<void> => {
	const key = pageResultKey(jobId, index);
	const stored = await preparePageResult(deps.artifacts, jobId, index, result);
	await deps.kv.put(key, JSON.stringify(stored), { expirationTtl: ttlOf(ttlSeconds) });
};

/** Shared by KV publication and canonical reads, preserving the existing inline/stub contract. */
export const preparePageResult = async (
	artifacts: ArtifactStore,
	jobId: string,
	index: number,
	result: PageResult,
	urlTtlSeconds?: number,
): Promise<StoredPageResult> => {
	const json = JSON.stringify(result);

	if (result.status === "error" || encoder.encode(json).byteLength <= MAX_INLINE_RESULT_BYTES) {
		return result;
	}

	const resultUrl = await artifacts.putResult(
		json,
		`${jobId}/${String(index).padStart(PAGE_INDEX_DIGITS, "0")}`,
		urlTtlSeconds,
	);
	const stub: StoredPageResult = {
		status: "ok",
		url: result.url,
		engine: result.engine,
		credits: result.credits,
		resultUrl,
	};
	return stub;
};

export const putJobMeta = async (
	deps: JobResultsDeps,
	meta: JobMeta,
	ttlSeconds: number = JOB_RESULT_TTL_SECONDS,
): Promise<void> => {
	await deps.kv.put(jobMetaKey(meta.jobId), JSON.stringify(meta), { expirationTtl: ttlOf(ttlSeconds) });
};

export const getJobMeta = async (deps: JobResultsDeps, jobId: string): Promise<JobMeta | undefined> => {
	const raw = await deps.kv.get(jobMetaKey(jobId));
	return raw === null ? undefined : (parseJson(raw) as JobMeta | undefined);
};

export interface PageResultsPage {
	results: StoredPageResult[];
	/** Absent once the listing is exhausted. */
	cursor?: string;
}

/**
 * One page of results, in index order.
 *
 * KV `list` is the only ordered index available here, so the listing drives the reads. A key
 * that has expired between `list` and `get` is skipped rather than surfaced as a null hole.
 */
export const listPageResults = async (
	deps: JobResultsDeps,
	jobId: string,
	cursor?: string,
	pageSize: number = DEFAULT_RESULTS_PAGE_SIZE,
): Promise<PageResultsPage> => {
	const metaKey = jobMetaKey(jobId);
	const listed = await deps.kv.list({
		prefix: jobKeyPrefix(jobId),
		limit: pageSize,
		...(cursor === undefined ? {} : { cursor }),
	});

	const names = listed.keys.map((key) => key.name).filter((name) => name !== metaKey);
	const values = await Promise.all(names.map((name) => deps.kv.get(name)));
	const results = values
		.map((value) => (value === null ? undefined : (parseJson(value) as StoredPageResult | undefined)))
		.filter((value): value is StoredPageResult => value !== undefined);

	return listed.list_complete || !listed.cursor ? { results } : { results, cursor: listed.cursor };
};

/** A corrupt value must not fail a whole page of results; it is dropped like an expired key. */
const parseJson = (raw: string): unknown => {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
};
