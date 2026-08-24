import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHtml } from "./fetch";

const stubOf = (target: string) =>
	`<html><head><meta http-equiv="refresh" content="0; url=${target}"></head><body>Redirecting…</body></html>`;

const fakeFetch = (pages: Record<string, string>) =>
	vi.fn((input: RequestInfo | URL) => {
		const url = String(input);
		const body = pages[url];
		if (body === undefined) {
			return Promise.reject(new Error(`unexpected fetch: ${url}`));
		}
		return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/html" } }));
	});

describe("Fetch loader", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("should load the HTML of a URL", async () => {
		const html = await loadHtml("https://example.com");
		expect(html).toContain("Example Domain");
	});

	it("follows a meta-refresh stub to the real page", async () => {
		const fetchMock = fakeFetch({
			"https://site.test/": stubOf("/ja/"),
			"https://site.test/ja/": "<html><body><h1>本文</h1></body></html>",
		});
		vi.stubGlobal("fetch", fetchMock);

		const html = await loadHtml("https://site.test/");
		expect(html).toContain("本文");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("stops following after the hop cap instead of looping", async () => {
		// a → b → a → b …: each hop declares a refresh, so only the cap ends the chain.
		const fetchMock = fakeFetch({
			"https://site.test/a": stubOf("/b"),
			"https://site.test/b": stubOf("/a"),
		});
		vi.stubGlobal("fetch", fetchMock);

		const html = await loadHtml("https://site.test/a");
		expect(html).toContain("Redirecting");
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});
});
