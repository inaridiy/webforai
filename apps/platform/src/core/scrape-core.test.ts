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
