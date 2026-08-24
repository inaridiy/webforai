import { describe, expect, it } from "vitest";
import { minimalFilter, takumiExtractor } from "webforai";

import type { ArtifactStore } from "../artifacts/store";
import type { FetchLike } from "./rehost";
import { type ScrapeDeps, resolveExtractors, scrapePage } from "./scrape-core";
import { type Engine, type EngineFetchParams, type EngineSet, type FetchedPage, PlatformError } from "./types";

const PAGE_HTML = `<!doctype html>
<html lang="en"><head><title>Test page</title><meta name="description" content="a fixture"></head>
<body>
	<nav><a href="/elsewhere">nav</a></nav>
	<article>
		<h1>Test page</h1>
		<p>First paragraph with enough words to look like real prose for the extractor.</p>
		<p>Second paragraph with an image: <img src="/pic.png" alt="pic"></p>
	</article>
</body></html>`;

const engineCalls: { engine: Engine; params: EngineFetchParams }[] = [];

const fakeEngines = (overrides: Partial<Record<Engine, (params: EngineFetchParams) => Promise<FetchedPage>>> = {}) => {
	engineCalls.length = 0;
	const base =
		(engine: Engine) =>
		(params: EngineFetchParams): Promise<FetchedPage> => {
			engineCalls.push({ engine, params });
			return Promise.resolve({ html: PAGE_HTML, url: params.url, status: 200 });
		};
	return {
		fetch: overrides.fetch ?? base("fetch"),
		"proxy-fetch": overrides["proxy-fetch"] ?? base("proxy-fetch"),
		"proxy-browser": overrides["proxy-browser"] ?? base("proxy-browser"),
		browser: overrides.browser ?? base("browser"),
	} satisfies EngineSet;
};

const fakeArtifacts = () => {
	const calls: { kind: string; hint: string; bytes: number }[] = [];
	const artifacts: ArtifactStore = {
		putScreenshot: (bytes, keyHint) => {
			calls.push({ kind: "screenshot", hint: keyHint, bytes: bytes.byteLength });
			return Promise.resolve("https://cdn.example.com/shot.png");
		},
		putImage: (bytes, _contentType, keyHint) => {
			calls.push({ kind: "image", hint: keyHint, bytes: bytes.byteLength });
			return Promise.resolve("https://cdn.example.com/img.png");
		},
		putResult: () => Promise.resolve("https://cdn.example.com/result.json"),
	};
	return { artifacts, calls };
};

const request = (overrides: Partial<Parameters<typeof scrapePage>[1]> = {}) => ({
	url: "https://example.com/article",
	engine: "fetch" as Engine,
	screenshot: false,
	rehostImages: false,
	convert: {},
	...overrides,
});

const neverFetch: FetchLike = () => Promise.reject(new Error("no network in unit tests"));

const deps = (engines: EngineSet, artifacts: ArtifactStore, fetchImpl: FetchLike = neverFetch): ScrapeDeps => ({
	engines,
	artifacts,
	fetch: fetchImpl,
});

describe("extractor presets", () => {
	it("maps API presets onto webforai's extractor pipeline", () => {
		// `auto` stays undefined so webforai applies DEFAULT_EXTRACTORS ([autoExtractor]).
		expect(resolveExtractors("auto")).toBeUndefined();
		expect(resolveExtractors(undefined)).toBeUndefined();
		expect(resolveExtractors("takumi")).toBe(takumiExtractor);
		expect(resolveExtractors("minimal")).toBe(minimalFilter);
		expect(resolveExtractors("none")).toBe(false);
	});
});

describe("scrapePage", () => {
	it("converts the fetched page and prices the operation", async () => {
		const { artifacts } = fakeArtifacts();
		const result = await scrapePage(deps(fakeEngines(), artifacts), request());

		expect(engineCalls).toEqual([
			{ engine: "fetch", params: { url: "https://example.com/article", screenshot: false } },
		]);
		expect(result.engine).toBe("fetch");
		expect(result.url).toBe("https://example.com/article");
		expect(result.markdown).toContain("Test page");
		expect(result.markdown).toContain("First paragraph");
		expect(result.metadata.title).toBe("Test page");
		expect(result.credits).toBe(1);
		expect(result.screenshotUrl).toBeUndefined();
		expect(result.images).toBeUndefined();
	});

	it("reports the engine's final URL, not the requested one", async () => {
		const { artifacts } = fakeArtifacts();
		const engines = fakeEngines({
			fetch: () => Promise.resolve({ html: PAGE_HTML, url: "https://example.com/final", status: 200 }),
		});
		const result = await scrapePage(deps(engines, artifacts), request());
		expect(result.url).toBe("https://example.com/final");
	});

	it("emits frontmatter by default and skips it when asked", async () => {
		const { artifacts } = fakeArtifacts();
		const withFm = await scrapePage(deps(fakeEngines(), artifacts), request());
		const withoutFm = await scrapePage(deps(fakeEngines(), artifacts), request({ convert: { frontmatter: false } }));

		expect(withFm.markdown.startsWith("---")).toBe(true);
		expect(withoutFm.markdown.startsWith("---")).toBe(false);
	});

	it("keeps page chrome when the extractor preset is 'none'", async () => {
		const { artifacts } = fakeArtifacts();
		const extracted = await scrapePage(deps(fakeEngines(), artifacts), request());
		const raw = await scrapePage(deps(fakeEngines(), artifacts), request({ convert: { extractor: "none" } }));

		expect(raw.markdown).toContain("nav");
		expect(extracted.markdown).not.toContain("nav");
	});

	it("rejects a screenshot on an engine that cannot take one, before fetching", async () => {
		const { artifacts } = fakeArtifacts();
		const engines = fakeEngines();

		await expect(scrapePage(deps(engines, artifacts), request({ screenshot: true }))).rejects.toMatchObject({
			code: "screenshot_unsupported",
			status: 400,
		});
		expect(engineCalls).toEqual([]);
	});

	it("rejects private and malformed URLs before fetching", async () => {
		const { artifacts } = fakeArtifacts();
		const engines = fakeEngines();

		await expect(scrapePage(deps(engines, artifacts), request({ url: "http://127.0.0.1/" }))).rejects.toBeInstanceOf(
			PlatformError,
		);
		expect(engineCalls).toEqual([]);
	});

	it("uploads the screenshot and charges for it", async () => {
		const { artifacts, calls } = fakeArtifacts();
		const engines = fakeEngines({
			browser: (params) =>
				Promise.resolve({
					html: PAGE_HTML,
					url: params.url,
					status: 200,
					screenshot: new Uint8Array([1, 2, 3, 4, 5]),
				}),
		});

		const result = await scrapePage(deps(engines, artifacts), request({ engine: "browser", screenshot: true }));

		expect(result.screenshotUrl).toBe("https://cdn.example.com/shot.png");
		expect(calls).toEqual([{ kind: "screenshot", hint: "https://example.com/article", bytes: 5 }]);
		expect(result.credits).toBe(6);
	});

	it("fails loudly when a screenshot engine returns no screenshot", async () => {
		const { artifacts } = fakeArtifacts();
		const engines = fakeEngines({
			browser: (params) => Promise.resolve({ html: PAGE_HTML, url: params.url, status: 200 }),
		});

		await expect(
			scrapePage(deps(engines, artifacts), request({ engine: "browser", screenshot: true })),
		).rejects.toMatchObject({ code: "screenshot_failed", status: 502 });
	});

	it("rehosts images, rewrites the markdown, and prices the extra credit", async () => {
		const { artifacts, calls } = fakeArtifacts();
		const fetchImage: FetchLike = () =>
			Promise.resolve(
				new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }),
			);

		const result = await scrapePage(deps(fakeEngines(), artifacts, fetchImage), request({ rehostImages: true }));

		expect(result.images).toEqual([
			{ original: "https://example.com/pic.png", rehosted: "https://cdn.example.com/img.png" },
		]);
		expect(result.markdown).toContain("https://cdn.example.com/img.png");
		expect(calls).toEqual([{ kind: "image", hint: "https://example.com/pic.png", bytes: 3 }]);
		// engine (1) + one rehost batch (1)
		expect(result.credits).toBe(2);
	});

	it("keeps the original image URL when rehosting fails, and does not charge for it", async () => {
		const { artifacts } = fakeArtifacts();
		const fetchImage: FetchLike = () => Promise.resolve(new Response("gone", { status: 410 }));

		const result = await scrapePage(deps(fakeEngines(), artifacts, fetchImage), request({ rehostImages: true }));

		expect(result.images).toEqual([]);
		expect(result.markdown).toContain("https://example.com/pic.png");
		expect(result.credits).toBe(1);
	});

	it("keeps explicit engines out of shell detection warnings when content is real", async () => {
		const { artifacts } = fakeArtifacts();
		const result = await scrapePage(deps(fakeEngines(), artifacts), request());
		expect(result.warning).toBeUndefined();
	});

	it("propagates engine failures instead of falling back to another engine", async () => {
		const { artifacts } = fakeArtifacts();
		const engines = fakeEngines({
			"proxy-fetch": () => Promise.reject(new PlatformError("fetch_failed", "upstream responded 503", 502)),
		});

		await expect(scrapePage(deps(engines, artifacts), request({ engine: "proxy-fetch" }))).rejects.toMatchObject({
			code: "fetch_failed",
		});
		expect(engineCalls).toEqual([]);
	});
});

/** What a client-rendered SPA answers to a plain fetch: an empty mount point, no content. */
const SHELL_HTML = `<!doctype html>
<html lang="en"><head><title>Shell</title></head>
<body><div id="root"></div><script src="/assets/index.js"></script></body></html>`;

const shellThenRendered = (base: "fetch" | "proxy-fetch", rendered: "browser" | "proxy-browser") =>
	fakeEngines({
		[base]: (params: EngineFetchParams) => {
			engineCalls.push({ engine: base, params });
			return Promise.resolve({ html: SHELL_HTML, url: params.url, status: 200 });
		},
		[rendered]: (params: EngineFetchParams) => {
			engineCalls.push({ engine: rendered, params });
			return Promise.resolve({ html: PAGE_HTML, url: params.url, status: 200 });
		},
	});

describe("auto engine", () => {
	it("stays on plain fetch (1 credit) when the fetched HTML has real content", async () => {
		const { artifacts } = fakeArtifacts();
		const result = await scrapePage(deps(fakeEngines(), artifacts), request({ engine: "auto" }));

		expect(engineCalls.map((call) => call.engine)).toEqual(["fetch"]);
		expect(result.engine).toBe("fetch");
		expect(result.credits).toBe(1);
		expect(result.warning).toBeUndefined();
	});

	it("escalates a client-shell result to the browser and bills the browser price", async () => {
		const { artifacts } = fakeArtifacts();
		const result = await scrapePage(
			deps(shellThenRendered("fetch", "browser"), artifacts),
			request({ engine: "auto" }),
		);

		expect(engineCalls.map((call) => call.engine)).toEqual(["fetch", "browser"]);
		expect(result.engine).toBe("browser");
		expect(result.credits).toBe(5);
		expect(result.markdown).toContain("First paragraph");
		expect(result.warning).toBeUndefined();
	});

	it("uses the proxy pair when a region is set", async () => {
		const { artifacts } = fakeArtifacts();
		const result = await scrapePage(
			deps(shellThenRendered("proxy-fetch", "proxy-browser"), artifacts),
			request({ engine: "auto", region: "jp" }),
		);

		expect(engineCalls.map((call) => call.engine)).toEqual(["proxy-fetch", "proxy-browser"]);
		expect(result.engine).toBe("proxy-browser");
		expect(result.credits).toBe(5);
	});

	it("starts at the browser when a screenshot is requested", async () => {
		const { artifacts } = fakeArtifacts();
		const engines = fakeEngines({
			browser: (params) =>
				Promise.resolve({ html: PAGE_HTML, url: params.url, status: 200, screenshot: new Uint8Array([1, 2, 3]) }),
		});

		const result = await scrapePage(deps(engines, artifacts), request({ engine: "auto", screenshot: true }));

		expect(engineCalls).toEqual([]);
		expect(result.engine).toBe("browser");
		expect(result.credits).toBe(6);
		expect(result.screenshotUrl).toBe("https://cdn.example.com/shot.png");
	});

	it("returns the unrendered result with a warning when escalation fails", async () => {
		const { artifacts } = fakeArtifacts();
		const engines = fakeEngines({
			fetch: (params) => {
				engineCalls.push({ engine: "fetch", params });
				return Promise.resolve({ html: SHELL_HTML, url: params.url, status: 200 });
			},
			browser: () => Promise.reject(new PlatformError("engine_unavailable", "no browser binding", 503)),
		});

		const result = await scrapePage(deps(engines, artifacts), request({ engine: "auto" }));

		expect(result.engine).toBe("fetch");
		expect(result.credits).toBe(1);
		expect(result.warning).toContain('escalating to engine "browser" failed');
	});

	it("warns instead of escalating when a fetch-tier engine was chosen explicitly", async () => {
		const { artifacts } = fakeArtifacts();
		const engines = fakeEngines({
			fetch: (params) => {
				engineCalls.push({ engine: "fetch", params });
				return Promise.resolve({ html: SHELL_HTML, url: params.url, status: 200 });
			},
		});

		const result = await scrapePage(deps(engines, artifacts), request({ engine: "fetch" }));

		expect(engineCalls.map((call) => call.engine)).toEqual(["fetch"]);
		expect(result.engine).toBe("fetch");
		expect(result.credits).toBe(1);
		expect(result.warning).toContain("client-side app shell");
	});

	it("never runs shell detection on explicit browser engines", async () => {
		const { artifacts } = fakeArtifacts();
		const engines = fakeEngines({
			browser: (params) => Promise.resolve({ html: SHELL_HTML, url: params.url, status: 200 }),
		});

		const result = await scrapePage(deps(engines, artifacts), request({ engine: "browser" }));

		expect(result.engine).toBe("browser");
		expect(result.warning).toBeUndefined();
	});
});

/** An HTTP 200 language-redirect stub, the shape GitHub Pages serves for site roots. */
const redirectStubTo = (target: string): string =>
	`<html><head><title>Redirecting…</title><meta http-equiv="refresh" content="0; url=${target}"></head><body>Redirecting…</body></html>`;

/** Serves redirect stubs by path and real content everywhere else, recording every call. */
const stubServingEngine =
	(engine: Engine, stubs: Record<string, string>) =>
	(params: EngineFetchParams): Promise<FetchedPage> => {
		engineCalls.push({ engine, params });
		const path = new URL(params.url).pathname;
		const target = stubs[path];
		return Promise.resolve({
			html: target === undefined ? PAGE_HTML : redirectStubTo(target),
			url: params.url,
			status: 200,
		});
	};

describe("meta-refresh redirects", () => {
	it("follows a redirect stub on the same engine and bills one operation", async () => {
		const { artifacts } = fakeArtifacts();
		const engines = fakeEngines({ fetch: stubServingEngine("fetch", { "/article": "/ja/" }) });

		const result = await scrapePage(deps(engines, artifacts), request());

		expect(engineCalls.map((call) => [call.engine, call.params.url])).toEqual([
			["fetch", "https://example.com/article"],
			["fetch", "https://example.com/ja/"],
		]);
		expect(result.engine).toBe("fetch");
		expect(result.credits).toBe(1);
		expect(result.url).toBe("https://example.com/ja/");
		expect(result.markdown).toContain("First paragraph");
		expect(result.warning).toBeUndefined();
	});

	it("keeps auto on the fetch tier when the stub's target has real content", async () => {
		const { artifacts } = fakeArtifacts();
		const engines = fakeEngines({ fetch: stubServingEngine("fetch", { "/article": "/ja/" }) });

		const result = await scrapePage(deps(engines, artifacts), request({ engine: "auto" }));

		expect(engineCalls.map((call) => call.engine)).toEqual(["fetch", "fetch"]);
		expect(result.engine).toBe("fetch");
		expect(result.credits).toBe(1);
	});

	it("stops at the hop cap instead of looping", async () => {
		const { artifacts } = fakeArtifacts();
		// /a → /b → /a → … : every page is a stub, so only the cap ends the chain.
		const engines = fakeEngines({ fetch: stubServingEngine("fetch", { "/a": "/b", "/b": "/a" }) });

		const result = await scrapePage(
			deps(engines, artifacts),
			request({ url: "https://example.com/a", engine: "fetch" }),
		);

		// initial fetch + 3 hops; the leftover stub then reads as a shell and warns.
		expect(engineCalls).toHaveLength(4);
		expect(result.credits).toBe(1);
		expect(result.warning).toBeDefined();
	});

	it("rejects a hop target that fails the SSRF guard", async () => {
		const { artifacts } = fakeArtifacts();
		const engines = fakeEngines({ fetch: stubServingEngine("fetch", { "/article": "http://127.0.0.1/admin" }) });

		await expect(scrapePage(deps(engines, artifacts), request())).rejects.toBeInstanceOf(PlatformError);
	});

	it("does not follow stubs returned by browser engines — they follow refreshes themselves", async () => {
		const { artifacts } = fakeArtifacts();
		const engines = fakeEngines({ browser: stubServingEngine("browser", { "/article": "/ja/" }) });

		const result = await scrapePage(deps(engines, artifacts), request({ engine: "browser" }));

		expect(engineCalls).toHaveLength(1);
		expect(result.engine).toBe("browser");
	});
});
