import { PlatformApiError } from "./error.js";
import { type FetchLike, type FetchResponseLike, resolveFetch } from "./fetch.js";
import {
	type BatchOptions,
	type CrawlOptions,
	type DemoResult,
	type DemoScrapeOptions,
	type JobRef,
	type JobResultsPage,
	type JobStatus,
	type PageResult,
	type PageSuccess,
	type ScrapeOptions,
	type ScrapeResult,
	isStoredPageStub,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://platform.webforai.dev";

const TERMINAL_STATES = new Set(["completed", "failed"]);

export interface PlatformClientOptions {
	/**
	 * API key (`wfa_...`), created on the platform dashboard. Required for everything except
	 * `demoScrape`. Sent as `Authorization: Bearer <key>`.
	 */
	apiKey?: string;
	/** Origin of the platform deployment; point this at your own instance when self-hosting. */
	baseUrl?: string;
	/**
	 * Custom fetch implementation. Defaults to the global fetch (bound to `globalThis`).
	 *
	 * The type is structural ({@link FetchLike}), so it works in environments whose fetch
	 * typings differ from lib.dom — pass a Cloudflare Workers service binding
	 * (`(url, init) => env.PLATFORM.fetch(url, init)`), undici/node-fetch, or a test stub.
	 */
	fetch?: FetchLike;
}

export interface WaitForJobOptions {
	/** Delay between status polls. Default 2000ms. */
	pollIntervalMs?: number;
	/** Give up after this long with a `poll_timeout` `PlatformApiError`. Default 10 minutes. */
	timeoutMs?: number;
	signal?: AbortSignal;
	/** Called after every poll with the latest status — useful for progress display. */
	onStatus?: (status: JobStatus) => void;
}

export interface PlatformClient {
	/** Synchronous single-URL conversion. One request in, Markdown out. */
	scrape(options: ScrapeOptions): Promise<ScrapeResult>;
	/** Enqueues a single URL as an async job (`async: true`); poll it like a batch job. */
	scrapeAsync(options: ScrapeOptions): Promise<JobRef>;
	/** Async conversion of up to 100 URLs. */
	batch(options: BatchOptions): Promise<JobRef>;
	/** Async same-origin crawl from a seed URL. */
	crawl(options: CrawlOptions): Promise<JobRef>;
	getJob(jobId: string): Promise<JobStatus>;
	/** One page of raw results (page size 20); large results arrive as `resultUrl` stubs. */
	getJobResults(jobId: string, options?: { cursor?: string }): Promise<JobResultsPage>;
	/** Polls until the job completes or fails; the terminal status is returned, not thrown. */
	waitForJob(jobId: string, options?: WaitForJobOptions): Promise<JobStatus>;
	/**
	 * Iterates every page result of a job, following pagination and downloading spilled
	 * (`resultUrl`) results transparently. Call after `waitForJob` for a stable snapshot.
	 */
	jobResults(jobId: string): AsyncGenerator<PageResult, void, undefined>;
	/** The public, keyless, rate-limited demo endpoint (truncated output, no billing). */
	demoScrape(options: DemoScrapeOptions): Promise<DemoResult>;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
	new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});

const parseRetryAfter = (body: unknown, response: FetchResponseLike): number | undefined => {
	const fromBody = (body as { error?: { retryAfter?: unknown } } | undefined)?.error?.retryAfter;
	if (typeof fromBody === "number") {
		return fromBody;
	}
	const header = Number(response.headers.get("retry-after"));
	return Number.isFinite(header) && header > 0 ? header : undefined;
};

const toApiError = (response: FetchResponseLike, body: unknown): PlatformApiError => {
	const envelope = body as { error?: { code?: unknown; message?: unknown } } | undefined;
	const code = typeof envelope?.error?.code === "string" ? envelope.error.code : "invalid_response";
	const message =
		typeof envelope?.error?.message === "string"
			? envelope.error.message
			: `unexpected response (HTTP ${response.status})`;
	return new PlatformApiError(code, message, response.status, parseRetryAfter(body, response));
};

export const createPlatformClient = (options: PlatformClientOptions = {}): PlatformClient => {
	const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
	const fetchImpl = resolveFetch(options.fetch);

	const request = async <T>(path: string, init: { method: "GET" | "POST"; body?: unknown; auth: boolean }) => {
		const headers: Record<string, string> = { accept: "application/json" };
		if (init.body !== undefined) {
			headers["content-type"] = "application/json";
		}
		if (init.auth) {
			if (!options.apiKey) {
				throw new PlatformApiError(
					"missing_api_key",
					"This endpoint needs an API key: pass `apiKey` to createPlatformClient (create one on the platform dashboard).",
					0,
				);
			}
			headers.authorization = `Bearer ${options.apiKey}`;
		}

		const response = await fetchImpl(`${baseUrl}${path}`, {
			method: init.method,
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});

		const body: unknown = await response.json().catch(() => undefined);
		if (!response.ok) {
			throw toApiError(response, body);
		}
		if (body === undefined) {
			throw new PlatformApiError("invalid_response", "response body is not JSON", response.status);
		}
		return body as T;
	};

	const getJob = (jobId: string): Promise<JobStatus> =>
		request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: "GET", auth: true });

	const getJobResults = (jobId: string, opts?: { cursor?: string }): Promise<JobResultsPage> => {
		const query = opts?.cursor ? `?cursor=${encodeURIComponent(opts.cursor)}` : "";
		return request(`/v1/jobs/${encodeURIComponent(jobId)}/results${query}`, { method: "GET", auth: true });
	};

	const resolveStored = async (resultUrl: string): Promise<PageSuccess> => {
		const response = await fetchImpl(resultUrl, { method: "GET" });
		if (!response.ok) {
			throw new PlatformApiError(
				"artifact_fetch_failed",
				`stored result fetch failed (HTTP ${response.status}) — result URLs expire after ~24h`,
				response.status,
			);
		}
		return (await response.json()) as PageSuccess;
	};

	return {
		scrape: (opts: ScrapeOptions) => request<ScrapeResult>("/v1/scrape", { method: "POST", body: opts, auth: true }),

		scrapeAsync: (opts: ScrapeOptions) =>
			request<JobRef>("/v1/scrape", { method: "POST", body: { ...opts, async: true }, auth: true }),

		batch: (opts: BatchOptions) => request<JobRef>("/v1/batch", { method: "POST", body: opts, auth: true }),

		crawl: (opts: CrawlOptions) => request<JobRef>("/v1/crawl", { method: "POST", body: opts, auth: true }),

		getJob,
		getJobResults,

		waitForJob: async (jobId: string, opts: WaitForJobOptions = {}): Promise<JobStatus> => {
			const interval = opts.pollIntervalMs ?? 2000;
			const timeout = opts.timeoutMs ?? 10 * 60 * 1000;
			const startedAt = Date.now();

			for (;;) {
				const status = await getJob(jobId);
				opts.onStatus?.(status);
				if (TERMINAL_STATES.has(status.status)) {
					return status;
				}
				if (Date.now() - startedAt + interval > timeout) {
					throw new PlatformApiError("poll_timeout", `job ${jobId} still ${status.status} after ${timeout}ms`, 0);
				}
				await sleep(interval, opts.signal);
			}
		},

		jobResults: async function* (jobId: string) {
			let cursor: string | undefined;
			do {
				const page = await getJobResults(jobId, { cursor });
				for (const item of page.results) {
					yield isStoredPageStub(item) ? await resolveStored(item.resultUrl) : item;
				}
				cursor = page.cursor;
			} while (cursor);
		},

		demoScrape: (opts: DemoScrapeOptions) =>
			request<DemoResult>("/v1/demo/scrape", { method: "POST", body: opts, auth: false }),
	};
};
