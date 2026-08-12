import { type ExtractorSelectors, htmlToMarkdownWithMetadata, minimalFilter, takumiExtractor } from "webforai";

import type { ArtifactStore } from "../artifacts/store";
import { creditsFor } from "../billing/credits";
import { type FetchLike, rehostImages } from "./rehost";
import { assertPublicHttpUrl } from "./ssrf";
import {
	type ConvertOptions,
	type EngineSet,
	type FetchedPage,
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

const supportsScreenshot = (engine: ScrapeRequest["engine"]): boolean => SCREENSHOT_ENGINES.includes(engine);

/**
 * Guards + HTML acquisition — the first half of `scrapePage`.
 *
 * Split out (and exported) because the crawl Workflow must run link discovery on the *raw*
 * HTML, before extraction drops the navigation that a crawl traverses. Callers that only want
 * a converted page keep using `scrapePage`; this pair exists so no caller has to re-implement
 * the guards or the conversion.
 */
// biome-ignore lint/suspicious/useAwait: `async` so the guards below reject the promise instead of throwing synchronously
export const fetchForScrape = async (deps: ScrapeDeps, req: ScrapeRequest): Promise<FetchedPage> => {
	const target = assertPublicHttpUrl(req.url);

	// Checked before the fetch: an unsupported combination is a request error, and the caller
	// must not be charged for an engine run that could never satisfy it.
	if (req.screenshot && !supportsScreenshot(req.engine)) {
		throw new PlatformError("screenshot_unsupported", `engine "${req.engine}" cannot take screenshots`, 400);
	}

	return deps.engines[req.engine]({ url: target.href, screenshot: req.screenshot, region: req.region });
};

/** Conversion + artifacts + pricing — the second half of `scrapePage`, for an already fetched page. */
export const convertFetchedPage = async (
	deps: ScrapeDeps,
	req: ScrapeRequest,
	page: FetchedPage,
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
			throw new PlatformError("screenshot_failed", `engine "${req.engine}" returned no screenshot`, 502);
		}
		screenshotUrl = await deps.artifacts.putScreenshot(page.screenshot, page.url);
	}

	const rehosted = req.rehostImages
		? await rehostImages({ artifacts: deps.artifacts, fetch: deps.fetch }, markdown, page.url)
		: undefined;

	return {
		url: page.url,
		engine: req.engine,
		markdown: rehosted?.markdown ?? markdown,
		metadata: { ...metadata },
		credits: creditsFor({
			engine: req.engine,
			screenshot: req.screenshot,
			rehostedImages: rehosted?.images.length ?? 0,
		}),
		screenshotUrl,
		images: rehosted?.images,
	};
};

export const scrapePage = async (deps: ScrapeDeps, req: ScrapeRequest): Promise<ScrapeSuccess> =>
	convertFetchedPage(deps, req, await fetchForScrape(deps, req));
