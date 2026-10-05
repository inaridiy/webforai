import { describe, expect, it } from "vitest";

import type { ArtifactStore } from "../artifacts/store";
import { EscalationExhaustedError, type FetchedPage, PlatformError } from "../core/types";
import { type RpcConvertDeps, markdownImages, normalizeDate, rpcConvert, rpcTryConvert } from "./convert";

const PAGE = `<!doctype html><html><head><title>Install</title></head><body><main>
<h1>Installation</h1>
<p>Run the command below to add the component to your project and start using it today.</p>
<figure data-rehype-pretty-code-figure=""><pre data-language="bash"><code data-language="bash"><span data-line="">npx shadcn@latest add button</span></code></pre></figure>
<p>See <a href="/docs/theming#css">theming</a>, <a href="https://github.com/acme/ui">GitHub</a> and <a href="mailto:x@y.z">mail</a>.</p>
</main></body></html>`;

const harness = (
	overrides: {
		limit?: boolean;
		html?: string;
		fetch?: (url: string) => Promise<FetchedPage>;
		browser?: Partial<FetchedPage>;
	} = {},
) => {
	const calls: string[] = [];
	const engine =
		(name: string) =>
		({ url }: { url: string }) => {
			calls.push(name);
			if (name === "fetch" && overrides.fetch) {
				return overrides.fetch(url);
			}
			return Promise.resolve({
				html: overrides.html ?? PAGE,
				url,
				status: 200,
				...(name === "browser" ? overrides.browser : {}),
			});
		};
	const keys: string[] = [];
	const deps: RpcConvertDeps = {
		scrape: {
			engines: {
				fetch: engine("fetch"),
				browser: engine("browser"),
				"proxy-fetch": engine("proxy-fetch"),
				"proxy-browser": engine("proxy-browser"),
			},
			artifacts: {} as ArtifactStore,
		},
		limiter: {
			limit: ({ key }) => {
				keys.push(key);
				return Promise.resolve({ success: overrides.limit ?? true });
			},
		},
		log: { info: () => undefined, warn: () => undefined },
	};
	return { deps, calls, keys };
};

describe("rpcConvert", () => {
	it("returns markdown with the code block's language and the page's links", async () => {
		const { deps, calls, keys } = harness();
		const result = await rpcConvert(deps, "https://ui.example.com/docs/install", {
			tenant: "shadcn-explorer",
			formats: ["markdown", "links"],
		});

		expect(calls).toEqual(["fetch"]);
		expect(keys).toEqual(["shadcn-explorer"]);
		expect(result.engine).toBe("fetch");
		expect(result.markdown).toContain("```bash\nnpx shadcn@latest add button\n```");
		expect(result.links).toEqual(["https://ui.example.com/docs/theming", "https://github.com/acme/ui"]);
		expect(result.metadata).toMatchObject({ title: "Install" });
	});

	it("skips conversion for links only and never offers proxy engines", async () => {
		const { deps } = harness();
		const result = await rpcConvert(deps, "https://ui.example.com/", { tenant: "t", formats: ["links"] });
		expect(result.markdown).toBe("");
		expect(result.links).toHaveLength(2);

		await expect(rpcConvert(deps, "https://ui.example.com/", { tenant: "t", engine: "proxy-fetch" })).rejects.toThrow(
			/^invalid_request: /,
		);
	});

	it("rejects bad input, private targets and an exhausted tenant with coded messages", async () => {
		await expect(rpcConvert(harness().deps, "not a url", { tenant: "t" })).rejects.toThrow(/^invalid_request: url/);
		await expect(rpcConvert(harness().deps, "https://x.com", {})).rejects.toThrow(/^invalid_request: tenant/);
		await expect(rpcConvert(harness().deps, "http://169.254.169.254/", { tenant: "t" })).rejects.toThrow(
			/^invalid_url: /,
		);
		await expect(rpcConvert(harness({ limit: false }).deps, "https://x.com", { tenant: "t" })).rejects.toThrow(
			/^rate_limited: /,
		);
	});
});

const ARTICLE = `<!doctype html><html lang="en"><head><title>On sourdough - Bread Notes</title>
<meta property="og:site_name" content="Bread Notes">
<meta property="article:published_time" content="Tue, 01 Oct 2026 10:00:00 GMT">
<meta name="author" content="A. Baker"></head><body><article>
<p>Sourdough is bread leavened by a culture of wild yeast and lactic acid bacteria kept by the baker.</p>
<p><img src="/img/loaf.png" alt="A loaf"> The crumb is open when the dough is well fermented and shaped with care.</p>
<pre><code>![not an image](/in/code.png)</code></pre>
<p>Feed the starter twice a day and keep it warm; a lively starter doubles within six hours.</p>
</article></body></html>`;

describe("rpcTryConvert", () => {
	it("returns the body alone with typed metadata, the extraction report and the images", async () => {
		const outcome = await rpcTryConvert(harness({ html: ARTICLE }).deps, "https://bread.example/sourdough", {
			tenant: "rebabel-dev",
			frontmatter: false,
			titleHeading: false,
		});
		if (!outcome.ok) throw new Error(outcome.error.message);
		const { result } = outcome;

		expect(result.markdown.startsWith("---")).toBe(false);
		expect(result.markdown).not.toContain("# On sourdough");
		expect(result.engine).toBe("fetch");
		expect(result.metadata).toMatchObject({
			title: "On sourdough - Bread Notes",
			siteName: "Bread Notes",
			author: "A. Baker",
			published: "2026-10-01T10:00:00.000Z",
		});
		expect(result.extraction).toMatchObject({ extractor: expect.any(String), textLength: expect.any(Number) });
		expect(result.extraction?.textLength).toBeGreaterThan(100);
		expect(result.images).toEqual([{ url: "https://bread.example/img/loaf.png", alt: "A loaf" }]);
	});

	it("ignores option keys it does not know", async () => {
		const outcome = await rpcTryConvert(harness().deps, "https://ui.example.com/", { tenant: "t", future: true });
		expect(outcome.ok).toBe(true);
	});

	it("codes a followed meta refresh and an unsettled browser render as warnings", async () => {
		const stub = `<html><head><meta http-equiv="refresh" content="0; url=/ja/"></head><body>Redirecting…</body></html>`;
		const refreshed = await rpcTryConvert(
			harness({
				fetch: (url) => Promise.resolve({ html: url.endsWith("/ja/") ? PAGE : stub, url, status: 200 }),
			}).deps,
			"https://ui.example.com/",
			{ tenant: "t" },
		);
		expect(refreshed.ok && refreshed.result.warnings?.map((w) => w.code)).toEqual(["meta_refresh_followed"]);
		expect(refreshed.ok && refreshed.result.url).toBe("https://ui.example.com/ja/");

		const slow = await rpcTryConvert(harness({ browser: { renderTimedOut: true } }).deps, "https://ui.example.com/", {
			tenant: "t",
			engine: "browser",
		});
		expect(slow.ok && slow.result.warnings?.map((w) => w.code)).toEqual(["browser_timeout"]);
		expect(slow.ok && slow.result.engine).toBe("browser");
	});

	it("returns failures as data, with the upstream status, content type and retryability", async () => {
		const failing = (error: Error) => harness({ fetch: () => Promise.reject(error) }).deps;
		const tryWith = (error: Error) =>
			rpcTryConvert(failing(error), "https://x.example/", { tenant: "t", engine: "fetch" });

		expect(
			await tryWith(new PlatformError("fetch_failed", "upstream responded 404 for https://x.example/", 502)),
		).toEqual({
			ok: false,
			error: {
				code: "fetch_failed",
				message: "upstream responded 404 for https://x.example/",
				httpStatus: 404,
				retryable: false,
			},
		});
		expect(
			await tryWith(new PlatformError("fetch_failed", "upstream responded 503 for https://x.example/", 502)),
		).toMatchObject({
			error: { httpStatus: 503, retryable: true },
		});
		expect(
			await tryWith(new PlatformError("fetch_failed", "upstream responded 429 for https://x.example/", 502)),
		).toMatchObject({
			error: { httpStatus: 429, retryable: true },
		});
		expect(await tryWith(new PlatformError("fetch_failed", "network connection lost", 502))).toMatchObject({
			error: { code: "fetch_failed", retryable: true },
		});
		expect(
			await tryWith(new EscalationExhaustedError("fetch_failed", "engine fetch failed; browser too", 502)),
		).toMatchObject({
			error: { retryable: false },
		});
		expect(
			await tryWith(
				new PlatformError("unsupported_content_type", 'cannot convert content-type "application/pdf"', 415),
			),
		).toMatchObject({ error: { code: "unsupported_content_type", contentType: "application/pdf", retryable: false } });
		expect(await tryWith(new PlatformError("engine_unavailable", "no browser binding", 503))).toMatchObject({
			error: { code: "engine_failed", retryable: true },
		});
		expect(await tryWith(new Error("boom"))).toMatchObject({ error: { code: "internal_error", retryable: true } });

		expect(await rpcTryConvert(harness().deps, "not a url", { tenant: "t" })).toMatchObject({
			ok: false,
			error: { code: "invalid_request", retryable: false },
		});
		expect(await rpcTryConvert(harness({ limit: false }).deps, "https://x.example/", { tenant: "t" })).toMatchObject({
			ok: false,
			error: { code: "rate_limited", retryable: true },
		});
	});
});

describe("normalizeDate", () => {
	it("keeps ISO dates, converts other parseable dates and leaves the rest verbatim", () => {
		expect(normalizeDate("2026-10-01")).toBe("2026-10-01");
		expect(normalizeDate("2026-10-01T09:00:00+09:00")).toBe("2026-10-01T09:00:00+09:00");
		expect(normalizeDate("Tue, 01 Oct 2026 10:00:00 GMT")).toBe("2026-10-01T10:00:00.000Z");
		expect(normalizeDate("令和8年10月1日")).toBe("令和8年10月1日");
	});
});

describe("markdownImages", () => {
	it("lists images outside code fences, absolute and once each, skipping data URLs", () => {
		const markdown = [
			"![a](https://cdn.example/a.png)",
			"```md",
			"![b](https://cdn.example/b.png)",
			"```",
			"![](/c.png) ![a again](https://cdn.example/a.png) ![d](data:image/png;base64,AAAA)",
		].join("\n");
		expect(markdownImages(markdown, "https://site.example/post")).toEqual([
			{ url: "https://cdn.example/a.png", alt: "a" },
			{ url: "https://site.example/c.png" },
		]);
	});
});
