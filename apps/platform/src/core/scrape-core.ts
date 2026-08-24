import {
	type ClientShellReason,
	type ExtractorSelectors,
	detectClientShell,
	htmlToMarkdownWithMetadata,
	minimalFilter,
	takumiExtractor,
} from "webforai";

import type { ArtifactStore } from "../artifacts/store";
import { creditsFor } from "../billing/credits";
import { type FetchLike, rehostImages } from "./rehost";
import { assertPublicHttpUrl } from "./ssrf";
import {
	type AcquiredPage,
	type ConvertOptions,
	type Engine,
	type EngineSet,
	PlatformError,
	SCREENSHOT_ENGINES,
	type ScrapeRequest,
	type ScrapeSuccess,
	toHtmlToMarkdownOptions,
} from "./types";

/**
 * The single scrape pipeline: acquire HTML → convert → optional artifacts → price.
 *
 * The sync route calls this inline; the crawl Workflow calls it once per URL inside a step.
 * Everything with a side effect is injected, so the whole flow is unit-testable without
 * Cloudflare and without the network.
 */
export interface ScrapeDeps {
	engines: EngineSet;
	artifacts: ArtifactStore;
	/** Injected by unit tests for image rehosting; defaults to the runtime `fetch`. */
	fetch?: FetchLike;
}

/**
 * Maps the API's extractor preset onto webforai's extractor pipeline.
 *
 * - `auto` (and an unset preset) leave `extractors` undefined so webforai applies its own
 *   default, `DEFAULT_EXTRACTORS = [autoExtractor]`.
 * - `takumi` / `minimal` pin a single preset extractor.
 * - `none` passes `false`, which `pipeExtractors` skips — the whole document is converted.
 */
export const resolveExtractors = (preset: ConvertOptions["extractor"]): ExtractorSelectors | undefined => {
	switch (preset) {
		case "takumi":
			return takumiExtractor;
		case "minimal":
			return minimalFilter;
		case "none":
			return false;
		default:
			return undefined;
	}
};

const supportsScreenshot = (engine: Engine): boolean => SCREENSHOT_ENGINES.includes(engine);

/** The base engine an `auto` request starts with, and the browser sibling it may escalate to. */
const resolveAuto = (req: ScrapeRequest): { base: Engine; escalation?: Engine } => {
	// Only the proxy engines can honour geo-targeting, so an explicit region pins `auto` to
	// the proxy tier; a screenshot needs rendering, so it starts at the browser directly.
	const proxied = req.region !== undefined && req.region !== "auto";
	if (req.screenshot) {
		return { base: proxied ? "proxy-browser" : "browser" };
	}
	return proxied ? { base: "proxy-fetch", escalation: "proxy-browser" } : { base: "fetch", escalation: "browser" };
};

const SHELL_DESCRIPTION: Record<ClientShellReason, string> = {
	"spa-shell": "a client-side app shell whose content is built by JavaScript after load",
	"noscript-only": "a page that requires JavaScript to show its content",
	"empty-body": "a document with an empty body",
	"anti-bot-challenge": "an anti-bot challenge page",
};

const shellWarning = (reason: ClientShellReason): string =>
	`The fetched HTML looks like ${SHELL_DESCRIPTION[reason]}, so the converted markdown is probably empty. Retry with engine "auto" (escalates to browser rendering automatically) or a browser engine.`;

const escalationWarning = (reason: ClientShellReason, escalation: Engine, error: unknown): string =>
	`The fetched HTML looks like ${SHELL_DESCRIPTION[reason]}, but escalating to engine "${escalation}" failed (${
		error instanceof Error ? error.message : String(error)
	}); returning the unrendered result.`;

/**
 * Guards + HTML acquisition — the first half of `scrapePage`.
 *
 * Split out (and exported) because the crawl Workflow must run link discovery on the *raw*
 * HTML, before extraction drops the navigation that a crawl traverses. Callers that only want
 * a converted page keep using `scrapePage`; this pair exists so no caller has to re-implement
 * the guards or the conversion.
 *
 * `auto` resolves here: the base engine runs first, and when its HTML is a client-rendered
 * shell the browser sibling reruns the fetch. Explicit engines never substitute — a shell
 * result just carries a `warning`. The returned page names the engine that produced it, and
 * that engine is what `convertFetchedPage` prices.
 */
export const fetchForScrape = async (deps: ScrapeDeps, req: ScrapeRequest): Promise<AcquiredPage> => {
	const target = assertPublicHttpUrl(req.url);

	// Checked before the fetch: an unsupported combination is a request error, and the caller
	// must not be charged for an engine run that could never satisfy it. (`auto` always
	// satisfies a screenshot — it resolves to a browser engine.)
	if (req.screenshot && req.engine !== "auto" && !supportsScreenshot(req.engine)) {
		throw new PlatformError("screenshot_unsupported", `engine "${req.engine}" cannot take screenshots`, 400);
	}

	const { base, escalation } = req.engine === "auto" ? resolveAuto(req) : { base: req.engine, escalation: undefined };
	const params = { url: target.href, screenshot: req.screenshot, region: req.region };

	const page = await deps.engines[base](params);
	if (supportsScreenshot(base)) {
		// Browser engines already ran the page's JavaScript; there is nothing to detect.
		return { ...page, engine: base };
	}

	const verdict = detectClientShell(page.html);
	if (!verdict.isShell || verdict.reason === undefined) {
		return { ...page, engine: base };
	}
	if (escalation === undefined) {
		return { ...page, engine: base, warning: shellWarning(verdict.reason) };
	}
	try {
		const rendered = await deps.engines[escalation](params);
		return { ...rendered, engine: escalation };
	} catch (error) {
		// Best-effort: the caller asked for `auto`, and an unrendered page with a warning beats
		// a hard failure when the browser tier is unavailable on this deployment.
		return { ...page, engine: base, warning: escalationWarning(verdict.reason, escalation, error) };
	}
};

/** Conversion + artifacts + pricing — the second half of `scrapePage`, for an already fetched page. */
export const convertFetchedPage = async (
	deps: ScrapeDeps,
	req: ScrapeRequest,
	page: AcquiredPage,
): Promise<ScrapeSuccess> => {
	const { markdown, metadata } = htmlToMarkdownWithMetadata(page.html, {
		...toHtmlToMarkdownOptions(page.url, req.convert),
		extractors: resolveExtractors(req.convert.extractor),
	});

	let screenshotUrl: string | undefined;
	if (req.screenshot) {
		if (!page.screenshot) {
			// The engine claims screenshot support but returned none: a real failure, not a
			// silently degraded result.
			throw new PlatformError("screenshot_failed", `engine "${page.engine}" returned no screenshot`, 502);
		}
		screenshotUrl = await deps.artifacts.putScreenshot(page.screenshot, page.url);
	}

	const rehosted = req.rehostImages
		? await rehostImages({ artifacts: deps.artifacts, fetch: deps.fetch }, markdown, page.url)
		: undefined;

	return {
		url: page.url,
		engine: page.engine,
		markdown: rehosted?.markdown ?? markdown,
		metadata: { ...metadata },
		credits: creditsFor({
			engine: page.engine,
			screenshot: req.screenshot,
			rehostedImages: rehosted?.images.length ?? 0,
		}),
		screenshotUrl,
		images: rehosted?.images,
		...(page.warning === undefined ? {} : { warning: page.warning }),
	};
};

export const scrapePage = async (deps: ScrapeDeps, req: ScrapeRequest): Promise<ScrapeSuccess> =>
	convertFetchedPage(deps, req, await fetchForScrape(deps, req));
