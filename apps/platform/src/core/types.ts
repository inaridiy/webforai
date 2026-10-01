import type { HtmlToMarkdownOptions } from "webforai";
import type { Region } from "./regions";

export const ENGINES = ["fetch", "browser", "proxy-fetch", "proxy-browser"] as const;
export type Engine = (typeof ENGINES)[number];

/**
 * What a request may ask for: a concrete engine, or `auto` — the cheapest engine that can
 * satisfy the request, escalated to its browser sibling when the fetched HTML turns out to
 * be a client-rendered shell. Responses always report a concrete `Engine`.
 */
export const REQUESTED_ENGINES = [...ENGINES, "auto"] as const;
export type RequestedEngine = (typeof REQUESTED_ENGINES)[number];

/** Engines that render pages in a real browser and can produce screenshots. */
export const SCREENSHOT_ENGINES: readonly Engine[] = ["browser", "proxy-browser"];

export interface ConvertOptions {
	extractor?: "auto" | "takumi" | "minimal" | "none";
	frontmatter?: boolean;
	baseUrl?: string;
}

export interface ScrapeRequest {
	url: string;
	engine: RequestedEngine;
	screenshot: boolean;
	rehostImages: boolean;
	convert: ConvertOptions;
	/** Egress region; honoured by the proxy engines only. Absent means `auto`. */
	region?: Region;
	/**
	 * Honor the target site's robots.txt rules before fetching. Opt-in; absent means `false`
	 * (job requests stored before the option existed replay without it).
	 */
	respectRobotsTxt?: boolean;
}

/** What an engine returns: the rendered/raw HTML plus an optional screenshot. */
export interface FetchedPage {
	html: string;
	/** Final URL after redirects; used as the conversion base. */
	url: string;
	status: number;
	/** PNG bytes, present only when the request asked for a screenshot and the engine supports it. */
	screenshot?: Uint8Array;
}

/**
 * A fetched page bound to the engine that actually produced it. `engine` can differ from
 * the request's when that asked for `auto`; `warning` explains a result that is probably
 * not what the caller wanted (a client-rendered shell fetched without rendering).
 */
export type AcquiredPage = FetchedPage & { engine: Engine; warning?: string };

export interface EngineFetchParams {
	url: string;
	screenshot: boolean;
	/** Absent means `auto`; engines that cannot geo-target their egress ignore it. */
	region?: Region;
}

/**
 * Dependency object implemented differently per runtime: real bindings in the Worker,
 * fakes in unit tests. Engines whose secrets/bindings are missing must throw
 * `EngineUnavailableError`, never silently fall back to another engine.
 */
export type EngineSet = Record<Engine, (params: EngineFetchParams) => Promise<FetchedPage>>;

export interface ScrapeArtifacts {
	screenshotUrl?: string;
	images?: { original: string; rehosted: string }[];
}

export interface ScrapeSuccess extends ScrapeArtifacts {
	url: string;
	/** The engine that produced the result — `auto` requests resolve to a concrete one. */
	engine: Engine;
	markdown: string;
	metadata: Record<string, unknown>;
	credits: number;
	/** Present when the result is probably degraded (e.g. an unrendered client-side shell). */
	warning?: string;
}

export class PlatformError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

/**
 * `auto` tried both tiers and the browser tier itself reached the target and failed. Retrying
 * reruns the same fetch + browser pair against the same refusal, so jobs record the page as
 * failed instead of spending their retries (and browser time) on it. The HTTP contract is the
 * same as any other `PlatformError`.
 */
export class EscalationExhaustedError extends PlatformError {}

export class EngineUnavailableError extends PlatformError {
	constructor(engine: Engine, reason: string) {
		super("engine_unavailable", `engine "${engine}" is unavailable: ${reason}`, 503);
	}
}

export const toHtmlToMarkdownOptions = (url: string, convert: ConvertOptions): HtmlToMarkdownOptions => ({
	baseUrl: convert.baseUrl ?? url,
	url,
	frontmatter: convert.frontmatter ?? true,
	extractors: convert.extractor === "none" ? false : undefined,
});
