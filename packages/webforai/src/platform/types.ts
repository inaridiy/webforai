import type { ExtractorPreset } from "../extractors/preset-names";
import type { ExtractionReport } from "../extractors/types";
import type { PageMetadata } from "../metadata";

/**
 * Wire types for the webforai platform HTTP API (`/v1`) and its internal `PlatformRpc`
 * Service Binding entrypoint.
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
/** Egress regions the hosted platform can honour (Japan, or no geo-targeting). */
export const REGIONS = ["auto", "jp"] as const;
export type Region = (typeof REGIONS)[number];

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
	/**
	 * Honor the target site's robots.txt rules: each URL is checked before it is fetched, and a
	 * disallowed URL fails with `robots_disallowed` (never billed). Defaults to `false` for
	 * scrape and batch and to `true` for crawl (pass `false` to turn it off).
	 */
	respectRobotsTxt?: boolean;
	convert?: ConvertOptions;
}

export interface ScrapeOptions extends CommonRequestOptions {
	url: string;
}

export interface BatchOptions extends CommonRequestOptions {
	/** 1–100 URLs. */
	urls: string[];
}

/**
 * How a crawl uses the site's sitemaps (robots.txt `Sitemap:` lines, else `/sitemap.xml`):
 * `skip` (default) ignores them; `include` adds their same-origin URLs at depth 1 next to the
 * links found on pages; `only` crawls the seed plus sitemap URLs and follows no page links.
 */
export const CRAWL_SITEMAP_MODES = ["skip", "include", "only"] as const;
export type CrawlSitemapMode = (typeof CRAWL_SITEMAP_MODES)[number];

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
	/** Seed the crawl from the site's sitemaps; default `skip`. See {@link CRAWL_SITEMAP_MODES}. */
	sitemap?: CrawlSitemapMode;
}

export interface ScrapeResult {
	/** Final URL after redirects. */
	url: string;
	/** The engine that produced the result — `auto` requests resolve to a concrete one. */
	engine: Engine;
	markdown: string;
	metadata: Record<string, unknown>;
	/**
	 * Which extractor produced the content and, for kiwame, its confidence (0–1, about the
	 * expected token F1). Absent with `extractor: "none"` and from deployments before 2026-10-05.
	 */
	extraction?: ExtractionReport;
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
	/** Truncated to ~40,000 characters by the demo endpoint (~8000 before 2026-09-24). */
	markdown: string;
	truncated: boolean;
	title?: string;
	metadata: Record<string, unknown>;
}

/** Narrows a job-results item to the out-of-band stub form. */
export const isStoredPageStub = (item: JobResultItem): item is StoredPageStub =>
	item.status === "ok" && "resultUrl" in item;

/*
 * PlatformRpc — the internal conversion service other Workers on the platform's Cloudflare
 * account reach through a Service Binding:
 *
 *   services: [{ binding: "WEBFORAI", service: "webforai-platform", entrypoint: "PlatformRpc" }]
 *
 * No API key or billing: the binding is the credential. The platform implements these types
 * (`apps/platform/src/rpc/convert.ts` is checked against them), so they match the deployment.
 */

/** Engines the RPC offers; proxy engines are not available over RPC. */
export const RPC_ENGINES = ["auto", "fetch", "browser"] as const;
export type RpcEngine = (typeof RPC_ENGINES)[number];

export const RPC_FORMATS = ["markdown", "links"] as const;
export type RpcFormat = (typeof RPC_FORMATS)[number];

export interface RpcConvertOptions {
	/** Who is calling, for logs and the per-tenant rate limit: `/^[a-z0-9][a-z0-9._-]*$/i`, at most 64 characters. */
	tenant: string;
	/** Default `["markdown"]`. */
	formats?: RpcFormat[];
	/** Default `auto`. */
	extractor?: ExtractorPreset;
	/** Default `auto`: `fetch`, escalated to `browser` for a client-rendered shell or a bot wall. */
	engine?: RpcEngine;
	/** Prepend YAML front matter built from the page's metadata. Default `true`. */
	frontmatter?: boolean;
	/** Prepend the page title as a `#` heading when the content lacks one. Default `true`. */
	titleHeading?: boolean;
}

/** Metadata the page publishes about itself; `published`/`modified` are ISO-8601 when they parse, verbatim otherwise. */
export type RpcPageMetadata = PageMetadata;

export const RPC_WARNING_CODES = [
	/** The fetched HTML is a client-rendered shell and rendering it was not possible; the markdown is probably empty. */
	"client_shell_unrendered",
	/** The browser's render budget ran out before the network went idle; content loaded later may be missing. */
	"browser_timeout",
	/** kiwame's confidence is below 0.5: the extracted content probably misses or mixes up the main content. */
	"low_confidence",
	/** The URL answered with a `<meta http-equiv="refresh">` redirect, which was followed; `url` is where it led. */
	"meta_refresh_followed",
] as const;
export type RpcWarningCode = (typeof RPC_WARNING_CODES)[number];

export interface RpcWarning {
	code: RpcWarningCode;
	message: string;
}

export interface RpcConvertResult {
	/** The final URL after redirects. */
	url: string;
	/** The engine that produced the page (`auto` resolved). */
	engine: "fetch" | "browser";
	/** Empty when `formats` omits `markdown`; only the body when `frontmatter` and `titleHeading` are `false`. */
	markdown: string;
	/** Every http(s) link on the page, absolute, when `formats` includes `links`. */
	links?: string[];
	/** Present when `formats` includes `markdown`. */
	metadata?: RpcPageMetadata;
	/** Present when `formats` includes `markdown`. `textLength` counts the characters of the markdown body. */
	extraction?: { extractor: string; confidence: number | null; textLength: number };
	warnings?: RpcWarning[];
	/** Absolute URLs of the images left in the markdown, in order, each once. */
	images?: { url: string; alt?: string }[];
	/** @deprecated The first warning's message; read `warnings`. */
	warning?: string;
}

export const RPC_ERROR_CODES = [
	"invalid_request",
	"invalid_url",
	"rate_limited",
	"fetch_failed",
	"unsupported_content_type",
	"response_too_large",
	"engine_failed",
	"internal_error",
] as const;
export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

export interface RpcConvertError {
	code: RpcErrorCode;
	message: string;
	/** The upstream HTTP status, when the target answered with one (`fetch_failed`). */
	httpStatus?: number;
	/** The response's content type (`unsupported_content_type`, e.g. `application/pdf`). */
	contentType?: string;
	/** Whether the same call may succeed later. `false` for bad input, refusals the target will repeat, and unsupported content. */
	retryable: boolean;
}

export type RpcConvertOutcome = { ok: true; result: RpcConvertResult } | { ok: false; error: RpcConvertError };

/**
 * The `PlatformRpc` entrypoint. `convert` throws an `Error` whose message is `"<code>: <message>"`
 * (Workers RPC drops custom error properties); `tryConvert` returns failures as data.
 */
export interface PlatformRpc {
	convert(url: string, options: RpcConvertOptions): Promise<RpcConvertResult>;
	tryConvert(url: string, options: RpcConvertOptions): Promise<RpcConvertOutcome>;
}
