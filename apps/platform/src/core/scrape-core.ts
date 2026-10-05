import { type ClientShellReason, detectClientShell, extractMetaRefresh, htmlToMarkdownWithMetadata } from "webforai";

import type { ArtifactStore } from "../artifacts/store";
import { creditsFor } from "../billing/credits";
import { type FetchLike, rehostImages } from "./rehost";
import { ROBOTS_USER_AGENT_TOKEN, isAllowedByRobots, robotsPathOf } from "./robots";
import { type RobotsTxtLoader, createRobotsTxtLoader } from "./robots-fetch";
import { assertPublicHttpUrl } from "./ssrf";
import {
	type AcquiredPage,
	type AcquisitionNote,
	type Engine,
	type EngineSet,
	EscalationExhaustedError,
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
	/** Injected by unit tests for `respectRobotsTxt`; defaults to the edge-cached Workers loader. */
	robotsTxt?: RobotsTxtLoader;
}

const supportsScreenshot = (engine: Engine): boolean => SCREENSHOT_ENGINES.includes(engine);

/**
 * The opt-in robots.txt check. Runs once per URL before any engine is chosen, so it applies
 * to every engine and to `auto` escalation alike; a disallowed URL is a 4xx, which jobs record
 * as a failed page and which is never billed.
 */
const assertRobotsAllowed = async (deps: ScrapeDeps, target: URL): Promise<void> => {
	const loader = deps.robotsTxt ?? createRobotsTxtLoader();
	const robots = await loader(target);
	if (!isAllowedByRobots(robots, robotsPathOf(target), ROBOTS_USER_AGENT_TOKEN)) {
		throw new PlatformError(
			"robots_disallowed",
			`${target.origin}/robots.txt disallows ${target.href} for user-agent "${ROBOTS_USER_AGENT_TOKEN}"`,
			403,
		);
	}
};

/** Meta-refresh chains deeper than this are loops, not redirects. */
const MAX_META_REFRESH_HOPS = 3;

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

/**
 * Upstream statuses after which browser rendering plausibly succeeds where a plain fetch
 * failed: bot walls (403/406/429), challenge pages served as 503, and the Cloudflare edge
 * 52x/530 range. Plain origin errors (404, 410, 500, 502) look identical to a browser, so
 * escalating on those would only add cost.
 */
const ESCALATABLE_UPSTREAM_STATUS = new Set([403, 406, 429, 503, 520, 521, 522, 523, 524, 525, 526, 530]);

/**
 * Both fetch engines phrase upstream failures as `upstream responded <status> for <url>`
 * (`engines/workers-fetch.ts`, `engines/node.container.ts`); the phrase is the contract
 * this policy reads, because the container RPC flattens errors to their message.
 */
const UPSTREAM_STATUS_PATTERN = /upstream responded (\d{3})\b/;

const isEscalatableFetchFailure = (error: unknown): boolean => {
	if (!(error instanceof PlatformError) || error.code !== "fetch_failed") {
		return false;
	}
	const status = UPSTREAM_STATUS_PATTERN.exec(error.message)?.[1];
	// No parseable status means the request itself died (network error, timeout) — cases
	// where the browser's different egress and fingerprint regularly get through.
	return status === undefined || ESCALATABLE_UPSTREAM_STATUS.has(Number(status));
};

const escalationFailed = (base: Engine, cause: unknown, escalation: Engine, error: unknown): PlatformError => {
	const causeMessage = cause instanceof Error ? cause.message : String(cause);
	const code = error instanceof PlatformError ? error.code : "engine_failed";
	const status = error instanceof PlatformError ? error.status : 502;
	const detail = error instanceof Error ? error.message : String(error);
	const message = `engine "${base}" failed (${causeMessage}); escalation to "${escalation}" also failed: ${detail}`;
	// `fetch_failed` means the browser got as far as the target and was refused too. Anything
	// else (a launch or capacity error) is the browser tier's own trouble and worth a retry.
	const Failure = code === "fetch_failed" ? EscalationExhaustedError : PlatformError;
	return new Failure(code, message, status);
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

const renderNotes = (page: FetchedPage): AcquisitionNote[] =>
	page.renderTimedOut
		? [
				{
					code: "browser_timeout",
					message: "The page was still loading when the render budget ran out; content it loads later may be missing.",
				},
			]
		: [];

/** Binds a page to its engine, with the notes gathered on the way and the browser's own. */
const acquired = (page: FetchedPage, engine: Engine, notes: AcquisitionNote[], warning?: string): AcquiredPage => {
	const all = [...notes, ...renderNotes(page)];
	return {
		...page,
		engine,
		...(all.length === 0 ? {} : { notes: all }),
		...(warning === undefined ? {} : { warning }),
	};
};

/** The unrendered result of a shell: the REST `warning` and the same text as a coded note. */
const unrendered = (page: FetchedPage, engine: Engine, notes: AcquisitionNote[], warning: string): AcquiredPage =>
	acquired(page, engine, [...notes, { code: "client_shell_unrendered", message: warning }], warning);

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

	if (req.respectRobotsTxt) {
		await assertRobotsAllowed(deps, target);
	}

	const { base, escalation } = req.engine === "auto" ? resolveAuto(req) : { base: req.engine, escalation: undefined };
	const params = { url: target.href, screenshot: req.screenshot, region: req.region };

	if (supportsScreenshot(base)) {
		// Browser engines already ran the page's JavaScript; there is nothing to detect, and
		// they follow meta refreshes themselves.
		return acquired(await deps.engines[base](params), base, []);
	}

	let page: FetchedPage;
	const notes: AcquisitionNote[] = [];
	try {
		page = await deps.engines[base](params);

		// An HTTP 200 "Redirecting…" stub (`<meta http-equiv="refresh">`) is a redirect in all
		// but status code. Follow it on the same engine — exactly like the HTTP redirects every
		// engine already follows, and billed the same way: one operation. Each hop target passes
		// the same SSRF guard as the requested URL.
		for (let hop = 0; hop < MAX_META_REFRESH_HOPS; hop++) {
			const refresh = extractMetaRefresh(page.html, page.url);
			if (!refresh) {
				break;
			}
			const next = assertPublicHttpUrl(refresh.url);
			if (req.respectRobotsTxt) {
				await assertRobotsAllowed(deps, next);
			}
			page = await deps.engines[base]({ ...params, url: next.href });
			notes.push({
				code: "meta_refresh_followed",
				message: `Followed a <meta http-equiv="refresh"> redirect to ${next.href}.`,
			});
		}
	} catch (error) {
		// The fetch tier produced nothing at all. When the failure is one a real browser
		// regularly gets past (bot wall, challenge, edge 52x, network refusal), `auto`
		// escalates instead of failing — starting again from the requested URL, since the
		// browser follows redirects itself. Anything else (plain 404s, SSRF-refused hops,
		// oversized or non-HTML responses) is rethrown untouched.
		if (escalation === undefined || !isEscalatableFetchFailure(error)) {
			throw error;
		}
		try {
			return acquired(await deps.engines[escalation](params), escalation, []);
		} catch (escalationError) {
			throw escalationFailed(base, error, escalation, escalationError);
		}
	}

	const verdict = detectClientShell(page.html);
	if (!verdict.isShell || verdict.reason === undefined) {
		return acquired(page, base, notes);
	}
	if (escalation === undefined) {
		return unrendered(page, base, notes, shellWarning(verdict.reason));
	}
	try {
		// The browser starts again from the requested URL and follows any refresh itself.
		return acquired(await deps.engines[escalation](params), escalation, []);
	} catch (error) {
		// Best-effort: the caller asked for `auto`, and an unrendered page with a warning beats
		// a hard failure when the browser tier is unavailable on this deployment.
		return unrendered(page, base, notes, escalationWarning(verdict.reason, escalation, error));
	}
};

/** Conversion + artifacts + pricing — the second half of `scrapePage`, for an already fetched page. */
export const convertFetchedPage = async (
	deps: ScrapeDeps,
	req: ScrapeRequest,
	page: AcquiredPage,
): Promise<ScrapeSuccess> => {
	const { markdown, metadata, extraction } = htmlToMarkdownWithMetadata(
		page.html,
		toHtmlToMarkdownOptions(page.url, req.convert),
	);

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
		...(extraction === undefined ? {} : { extraction }),
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
