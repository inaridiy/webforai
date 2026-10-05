import { describe, expect, it } from "vitest";
import { annotateGeometry } from "webforai/loaders/geometry";

import { PlatformError } from "../core/types";
import {
	type GuardablePage,
	type GuardedRequest,
	type GuardedRoute,
	MAX_SCREENSHOT_BYTES,
	MAX_SCREENSHOT_HEIGHT_PX,
	type ScreenshotOptions,
	captureScreenshot,
	guardPageRequests,
	isAllowedPageRequest,
	readPageHtml,
	withRenderDeadline,
} from "./page-guard";
import { MAX_HTML_BYTES } from "./workers-fetch";

const fakeRequest = (url: string, resourceType = "document", redirectedFrom: GuardedRequest | null = null) => ({
	url: () => url,
	resourceType: () => resourceType,
	redirectedFrom: () => redirectedFrom,
});

/** Captures the route handler and request listener the guard installs, and replays requests through them. */
const fakePage = () => {
	let handler: ((route: GuardedRoute) => Promise<void>) | undefined;
	let listener: ((request: GuardedRequest) => void) | undefined;
	const page: GuardablePage = {
		context: () => ({
			route: (_url, routeHandler) => {
				handler = routeHandler;
				return Promise.resolve();
			},
		}),
		on: (_event, requestListener) => {
			listener = requestListener;
		},
	};
	/** Routes a request the way Playwright would: interception first, then the request event. */
	const route = async (request: GuardedRequest): Promise<"continued" | "aborted"> => {
		let outcome: "continued" | "aborted" = "continued";
		await handler?.({
			request: () => request,
			abort: () => {
				outcome = "aborted";
				return Promise.resolve();
			},
			continue: () => Promise.resolve(),
		});
		return outcome;
	};
	/** A redirect hop: never routed, only reported. */
	const redirectHop = (request: GuardedRequest) => listener?.(request);
	return { page, route, redirectHop, request: (request: GuardedRequest) => listener?.(request) };
};

describe("isAllowedPageRequest", () => {
	it("allows public http(s) and local schemes, refuses private targets", () => {
		expect(isAllowedPageRequest("https://example.com/app.js")).toBe(true);
		expect(isAllowedPageRequest("data:image/png;base64,AAAA")).toBe(true);
		expect(isAllowedPageRequest("blob:https://example.com/uuid")).toBe(true);
		expect(isAllowedPageRequest("about:blank")).toBe(true);
		expect(isAllowedPageRequest("http://127.0.0.1:8080/")).toBe(false);
		expect(isAllowedPageRequest("http://169.254.169.254/latest/meta-data/")).toBe(false);
		expect(isAllowedPageRequest("file:///etc/passwd")).toBe(false);
		expect(isAllowedPageRequest("ws://example.com/")).toBe(false);
	});
});

describe("guardPageRequests", () => {
	it("aborts subresources and frames that target private addresses", async () => {
		const { page, route } = fakePage();
		const guard = await guardPageRequests(page);

		expect(await route(fakeRequest("https://example.com/", "document"))).toBe("continued");
		expect(await route(fakeRequest("http://169.254.169.254/latest/meta-data/", "sub_frame"))).toBe("aborted");
		expect(await route(fakeRequest("http://10.0.0.5/internal.js", "script"))).toBe("aborted");
		expect(await route(fakeRequest("http://localhost:3000/img.png", "image"))).toBe("aborted");
		// Aborted before it left the browser: nothing to refuse the page over.
		expect(() => guard.assertClean()).not.toThrow();
	});

	it("blocks the requested resource types on top of the SSRF check", async () => {
		const { page, route } = fakePage();
		await guardPageRequests(page, { blockResourceTypes: new Set(["image", "font"]) });

		expect(await route(fakeRequest("https://example.com/a.png", "image"))).toBe("aborted");
		expect(await route(fakeRequest("https://example.com/a.woff2", "font"))).toBe("aborted");
		expect(await route(fakeRequest("https://example.com/app.js", "script"))).toBe("continued");
	});

	it("refuses the page when a redirect hop reached a private address", async () => {
		const { page, redirectHop } = fakePage();
		const guard = await guardPageRequests(page);

		const first = fakeRequest("https://example.com/redirect", "image");
		redirectHop(fakeRequest("https://cdn.example.com/ok.png", "image", first));
		expect(() => guard.assertClean()).not.toThrow();

		redirectHop(fakeRequest("http://127.0.0.1/admin", "image", first));
		expect(() => guard.assertClean()).toThrow(PlatformError);
		expect(() => guard.assertClean()).toThrow(/127\.0\.0\.1/);
	});

	it("leaves first requests to interception rather than refusing the page", async () => {
		const { page, request } = fakePage();
		const guard = await guardPageRequests(page);
		// A leftover dev link: aborted by the route handler, so the page itself is fine.
		request(fakeRequest("http://localhost:3000/dev.js", "script"));
		expect(() => guard.assertClean()).not.toThrow();
	});
});

describe("readPageHtml", () => {
	it("returns ordinary documents and refuses ones over the HTML cap", async () => {
		const evaluated: unknown[] = [];
		const page = (html: string) => ({
			content: () => Promise.resolve(html),
			evaluate: (fn: () => void) => {
				evaluated.push(fn);
				return Promise.resolve();
			},
		});
		await expect(readPageHtml(page("<p>hi</p>"))).resolves.toBe("<p>hi</p>");
		await expect(readPageHtml(page("<p>hi</p><script>bundle()</script>"))).resolves.toBe("<p>hi</p><script></script>");
		expect(evaluated).toEqual([annotateGeometry, annotateGeometry]);
		const scriptHeavy = `<p>hi</p><script>${"x".repeat(MAX_HTML_BYTES + 1)}</script>`;
		await expect(readPageHtml(page(scriptHeavy))).resolves.toBe("<p>hi</p><script></script>");
		const huge = "a".repeat(MAX_HTML_BYTES + 1);
		await expect(readPageHtml(page(huge))).rejects.toMatchObject({
			code: "response_too_large",
			status: 413,
		});
	});
});

describe("captureScreenshot", () => {
	it("clips full-page captures to the height cap", async () => {
		const calls: ScreenshotOptions[] = [];
		const shot = await captureScreenshot({
			screenshot: (options) => {
				calls.push(options);
				return Promise.resolve(new Uint8Array(10));
			},
		});
		expect(shot.byteLength).toBe(10);
		expect(calls).toEqual([
			{ type: "png", fullPage: true, clip: expect.objectContaining({ height: MAX_SCREENSHOT_HEIGHT_PX }) },
		]);
	});

	it("falls back to the viewport when the full page encodes too large, then gives up", async () => {
		const calls: ScreenshotOptions[] = [];
		const sizes = [MAX_SCREENSHOT_BYTES + 1, 100];
		const shot = await captureScreenshot({
			screenshot: (options) => {
				calls.push(options);
				return Promise.resolve({ byteLength: sizes.shift() ?? 0 });
			},
		});
		expect(shot.byteLength).toBe(100);
		expect(calls[1]).toEqual({ type: "png", fullPage: false });

		await expect(
			captureScreenshot({ screenshot: () => Promise.resolve({ byteLength: MAX_SCREENSHOT_BYTES + 1 }) }),
		).rejects.toMatchObject({ code: "response_too_large" });
	});
});

describe("withRenderDeadline", () => {
	it("returns the work's result inside the deadline", async () => {
		await expect(withRenderDeadline(() => Promise.resolve("html"), 50)).resolves.toBe("html");
	});

	it("rejects with fetch_failed when the work stalls", async () => {
		const stalled = new Promise<string>(() => undefined);
		await expect(withRenderDeadline(() => stalled, 10)).rejects.toMatchObject({ code: "fetch_failed", status: 504 });
	});
});
