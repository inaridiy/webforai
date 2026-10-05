import { annotateGeometry } from "webforai/loaders/geometry";

import { isPublicHttpUrl } from "../core/ssrf";
import { PlatformError } from "../core/types";
import { FETCH_TIMEOUT_MS, MAX_HTML_BYTES } from "./workers-fetch";

/**
 * Guards shared by both browser engines (`@cloudflare/playwright` in the Worker, Playwright in
 * the container). Typed structurally, like `navigate.ts`, so either page object fits and the
 * module stays pure enough to bundle into the container image.
 *
 * A browser loads far more than the URL it was given: subresources, iframes, redirects. Each of
 * those is a request the SSRF guard must see, not only the landing URL:
 *
 * - Every request the browser routes through interception is checked, and one to a private or
 *   local address is aborted before it leaves the browser.
 * - Playwright does not route redirect hops (the handler only sees the first URL of a chain), so
 *   those are watched through the `request` event instead. A hop that reached a private address
 *   cannot be un-sent, but the page is then refused (`invalid_url`): neither its HTML nor a
 *   screenshot of it is returned.
 *
 * Callers should also block service workers (`serviceWorkers: "block"`), whose fetches bypass
 * interception entirely.
 */

/** Data, blob and about URLs never become network requests. */
const LOCAL_SCHEME = /^(data|blob|about):/i;

export const isAllowedPageRequest = (url: string): boolean => LOCAL_SCHEME.test(url) || isPublicHttpUrl(url);

export interface GuardedRequest {
	url(): string;
	resourceType(): string;
	redirectedFrom(): GuardedRequest | null;
}

export interface GuardedRoute {
	request(): GuardedRequest;
	abort(errorCode?: string): Promise<void>;
	continue(): Promise<void>;
}

export interface GuardablePage {
	context(): { route(url: string, handler: (route: GuardedRoute) => Promise<void>): Promise<unknown> };
	on(event: "request", listener: (request: GuardedRequest) => void): unknown;
}

export interface RequestGuard {
	/** Throws `invalid_url` when a redirect hop slipped past interception to a private address. */
	assertClean(): void;
}

export interface GuardOptions {
	/** Resource types to abort as well (bandwidth saving on the proxy engine). */
	blockResourceTypes?: ReadonlySet<string>;
}

export const guardPageRequests = async (page: GuardablePage, options: GuardOptions = {}): Promise<RequestGuard> => {
	let escaped: string | undefined;

	page.on("request", (request) => {
		if (escaped === undefined && request.redirectedFrom() !== null && !isAllowedPageRequest(request.url())) {
			escaped = request.url();
		}
	});

	// Context-wide, so popups opened by the page are covered too.
	await page.context().route("**/*", (route) => {
		const request = route.request();
		if (!isAllowedPageRequest(request.url())) {
			return route.abort("blockedbyclient");
		}
		if (options.blockResourceTypes?.has(request.resourceType())) {
			return route.abort();
		}
		return route.continue();
	});

	return {
		assertClean: () => {
			if (escaped !== undefined) {
				throw new PlatformError(
					"invalid_url",
					`the page redirected a request to a private or local address (${escaped})`,
					400,
				);
			}
		},
	};
};

const encoder = new TextEncoder();

/**
 * The rendered DOM, held to the same 5 MiB ceiling as fetched HTML; oversized pages fail.
 *
 * Each element's rendered box is written into the DOM first (`data-rwidth`/`data-rheight`, the
 * library's `annotateGeometry`), so extraction drops what the browser laid out to nothing — menus
 * and sections hidden by CSS classes — exactly as the library's own browser loaders do.
 */
export const readPageHtml = async (page: {
	content(): Promise<string>;
	evaluate(fn: () => void): Promise<unknown>;
}): Promise<string> => {
	await page.evaluate(annotateGeometry);
	const html = await page.content();
	// Each UTF-16 code unit encodes to at most 3 UTF-8 bytes, so short documents skip encoding.
	if (html.length * 3 > MAX_HTML_BYTES && encoder.encode(html).byteLength > MAX_HTML_BYTES) {
		throw new PlatformError("response_too_large", `rendered page exceeds ${MAX_HTML_BYTES} bytes`, 413);
	}
	return html;
};

/** Full-page screenshots stop at this height; endless feeds would otherwise grow without bound. */
export const MAX_SCREENSHOT_HEIGHT_PX = 16_384;
export const MAX_SCREENSHOT_WIDTH_PX = 2_560;
/** Same ceiling as a rehosted image. */
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

export interface ScreenshotOptions {
	type: "png";
	fullPage: boolean;
	clip?: { x: number; y: number; width: number; height: number };
}

/**
 * A full-page PNG clipped to `MAX_SCREENSHOT_*_PX`. When even that encodes larger than
 * `MAX_SCREENSHOT_BYTES`, falls back to the viewport alone; past that the page fails.
 */
export const captureScreenshot = async <B extends { byteLength: number }>(page: {
	screenshot(options: ScreenshotOptions): Promise<B>;
}): Promise<B> => {
	const full = await page.screenshot({
		type: "png",
		fullPage: true,
		clip: { x: 0, y: 0, width: MAX_SCREENSHOT_WIDTH_PX, height: MAX_SCREENSHOT_HEIGHT_PX },
	});
	if (full.byteLength <= MAX_SCREENSHOT_BYTES) {
		return full;
	}
	const viewport = await page.screenshot({ type: "png", fullPage: false });
	if (viewport.byteLength <= MAX_SCREENSHOT_BYTES) {
		return viewport;
	}
	throw new PlatformError("response_too_large", `screenshot exceeds ${MAX_SCREENSHOT_BYTES} bytes`, 413);
};

/**
 * Whole-render budget: navigation has its own timeout, but `content()` and screenshots do not,
 * so a stalled renderer could otherwise hold a browser (and a container slot) indefinitely.
 */
export const RENDER_DEADLINE_MS = FETCH_TIMEOUT_MS + 30_000;

/**
 * Runs `work` under a deadline. On expiry it rejects with `fetch_failed`; the caller's
 * `finally { browser.close() }` then tears down whatever `work` was still waiting on.
 */
export const withRenderDeadline = async <T>(work: () => Promise<T>, ms: number = RENDER_DEADLINE_MS): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const running = work();
	// The losing promise settles after the browser closes; nobody awaits it any more.
	running.catch(() => undefined);
	try {
		return await Promise.race([
			running,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new PlatformError("fetch_failed", `rendering did not finish within ${ms} ms`, 504)),
					ms,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
};
