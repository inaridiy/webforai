import type { HtmlToMarkdownOptions } from "webforai";

export const ENGINES = ["fetch", "proxy-fetch", "proxy-browser", "cf-browser"] as const;
export type Engine = (typeof ENGINES)[number];

/** Engines that render pages in a real browser and can produce screenshots. */
export const SCREENSHOT_ENGINES: readonly Engine[] = ["proxy-browser", "cf-browser"];

export interface ConvertOptions {
	extractor?: "auto" | "takumi" | "minimal" | "none";
	frontmatter?: boolean;
	baseUrl?: string;
}

export interface ScrapeRequest {
	url: string;
	engine: Engine;
	screenshot: boolean;
	rehostImages: boolean;
	convert: ConvertOptions;
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

export interface EngineFetchParams {
	url: string;
	screenshot: boolean;
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
	engine: Engine;
	markdown: string;
	metadata: Record<string, unknown>;
	credits: number;
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
