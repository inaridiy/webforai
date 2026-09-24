/**
 * Wire types for the webforai platform HTTP API (`/v1`).
 *
 * These mirror the server contract exactly (`apps/platform/src/routes/*` in the webforai
 * repository is the source of truth). Request bodies are validated strictly server-side:
 * unknown keys are a `400`, so the client only ever sends fields the caller provided.
 */

/** How the platform acquires the page's HTML. */
export const ENGINES = ["fetch", "browser", "proxy-fetch", "proxy-browser"] as const;
export type Engine = (typeof ENGINES)[number];

/**
 * What a request may ask for: a concrete engine, or `auto` (the server default) — the
 * cheapest engine for the request, escalated to browser rendering when the fetched HTML is
 * a client-rendered shell. Responses report the concrete engine that ran.
 */
export const REQUESTED_ENGINES = [...ENGINES, "auto"] as const;
export type RequestedEngine = (typeof REQUESTED_ENGINES)[number];

/** Coarse egress location, honoured by the proxy engines only. */
export const REGIONS = ["auto", "us", "eu", "uk", "jp", "asia"] as const;
export type Region = (typeof REGIONS)[number];

/** Extraction presets understood by the platform (passed through to the webforai library). */
export type ExtractorPreset = "auto" | "takumi" | "minimal" | "none";

export interface ConvertOptions {
	extractor?: ExtractorPreset;
	/** Prepend YAML front matter built from the page's metadata. */
	frontmatter?: boolean;
	/** Base URL used to absolutize relative links; defaults to the fetched URL. */
	baseUrl?: string;
}

interface CommonRequestOptions {
	/** Defaults to `auto` server-side. */
	engine?: RequestedEngine;
	/** Browser engines only (`browser`, `proxy-browser`); +1 credit. */
	screenshot?: boolean;
	/** Re-upload the page's images behind expiring URLs; +1 credit per started 5 images. */
	rehostImages?: boolean;
	region?: Region;
	convert?: ConvertOptions;
}

export interface ScrapeOptions extends CommonRequestOptions {
	url: string;
}

export interface BatchOptions extends CommonRequestOptions {
	/** 1–100 URLs. */
	urls: string[];
}

export interface CrawlOptions extends CommonRequestOptions {
	url: string;
	/** 0–5, default 2. */
	maxDepth?: number;
	/** 1–500 pages, default 50. */
	limit?: number;
	/** Regexes matched against the pathname. */
	includePaths?: string[];
	excludePaths?: string[];
	/** The platform currently only supports same-origin crawls; sending `false` is a 400. */
	sameOrigin?: true;
}

export interface ScrapeResult {
	/** Final URL after redirects. */
	url: string;
	/** The engine that produced the result — `auto` requests resolve to a concrete one. */
	engine: Engine;
	markdown: string;
	metadata: Record<string, unknown>;
	credits: number;
	/** Present when a screenshot was requested; the URL expires after ~24h. */
	screenshotUrl?: string;
	/** Present when `rehostImages` was requested. */
	images?: { original: string; rehosted: string }[];
	/** Present when the result is probably degraded (e.g. an unrendered client-side shell). */
	warning?: string;
}

export interface JobRef {
	jobId: string;
}

export type JobType = "batch" | "crawl";
export type JobState = "queued" | "running" | "completed" | "failed";

export interface JobStatus {
	jobId: string;
	type: JobType;
	status: JobState;
	total: number;
	completed: number;
	failed: number;
	credits: number;
	/** When the stored results disappear (ISO timestamp, 7 days after creation). */
	expiresAt: string;
	/** Present only when the job failed. */
	error?: string;
}

export interface PageError {
	code: string;
	message: string;
}

export type PageSuccess = ScrapeResult & { status: "ok" };

export interface PageFailure {
	status: "error";
	url: string;
	/** As requested — a failed `auto` page never resolved to a concrete engine. */
	engine: RequestedEngine;
	error: PageError;
}

/** One page of an async job, after the client resolves any spilled results. */
export type PageResult = PageSuccess | PageFailure;

/**
 * Results larger than ~100KiB are stored out-of-band; the API returns this stub with an
 * expiring `resultUrl` instead of the inline markdown. `jobResults()` resolves these
 * automatically; `getJobResults()` returns them as-is.
 */
export interface StoredPageStub {
	status: "ok";
	url: string;
	engine: RequestedEngine;
	credits: number;
	resultUrl: string;
}

export type JobResultItem = PageResult | StoredPageStub;

export interface JobResultsPage {
	jobId: string;
	status: JobState;
	results: JobResultItem[];
	/** Absent on the last page. */
	cursor?: string;
}

export interface DemoScrapeOptions {
	url: string;
	region?: Region;
}

export interface DemoResult {
	url: string;
	region: Region;
	/** The engine `auto` resolved to. Absent from deployments older than 2026-09-24. */
	engine?: Engine;
	/** Truncated to ~8000 characters by the demo endpoint. */
	markdown: string;
	truncated: boolean;
	title?: string;
	metadata: Record<string, unknown>;
}

/** Narrows a job-results item to the out-of-band stub form. */
export const isStoredPageStub = (item: JobResultItem): item is StoredPageStub =>
	item.status === "ok" && "resultUrl" in item;
