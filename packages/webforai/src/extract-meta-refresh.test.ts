import { describe, expect, it } from "vitest";
import { extractMetaRefresh } from "./extract-meta-refresh";

/** The real delight.sfc.wide.ad.jp root stub (trimmed): HTTP 200, redirect via meta + JS. */
const redirectStub = `<!DOCTYPE html><html lang="ja"><head>
    <meta charset="utf-8">
    <title>Redirecting…</title>
    <meta http-equiv="refresh" content="0; url=/ja/">
    <script>location.replace("/ja/")</script>
  </head>
  <body>Redirecting… If not redirected, go to <a href="/ja/">/ja/</a>.</body></html>`;

describe("extractMetaRefresh", () => {
	it("follows the canonical GitHub Pages language-redirect stub", () => {
		const result = extractMetaRefresh(redirectStub, "https://delight.sfc.wide.ad.jp/");
		expect(result).toEqual({ url: "https://delight.sfc.wide.ad.jp/ja/", delaySeconds: 0 });
	});

	it("handles attribute order, casing and quoting variants", () => {
		const variants = [
			`<meta content="0;URL='https://example.com/next'" http-equiv="Refresh">`,
			`<META HTTP-EQUIV=refresh CONTENT="2; url=https://example.com/next">`,
			`<meta http-equiv='refresh' content='3 ; Url = "https://example.com/next"'>`,
		];
		for (const html of variants) {
			expect(extractMetaRefresh(html)?.url).toBe("https://example.com/next");
		}
	});

	it("resolves relative targets against the base URL", () => {
		const html = `<meta http-equiv="refresh" content="0; url=../en/">`;
		expect(extractMetaRefresh(html, "https://example.com/ja/page/")?.url).toBe("https://example.com/ja/en/");
	});

	it("ignores a refresh without a URL — that is a reload timer", () => {
		expect(extractMetaRefresh(`<meta http-equiv="refresh" content="300">`, "https://example.com/")).toBeUndefined();
	});

	it("ignores long delays — auto-reload, not a redirect", () => {
		const html = `<meta http-equiv="refresh" content="30; url=/live/">`;
		expect(extractMetaRefresh(html, "https://example.com/")).toBeUndefined();
	});

	it("ignores a refresh pointing at the page itself", () => {
		const html = `<meta http-equiv="refresh" content="5; url=https://example.com/">`;
		expect(extractMetaRefresh(html, "https://example.com/")).toBeUndefined();
	});

	it("ignores non-http targets and unresolvable relative targets", () => {
		expect(
			extractMetaRefresh(`<meta http-equiv="refresh" content="0; url=javascript:alert(1)">`, "https://example.com/"),
		).toBeUndefined();
		expect(extractMetaRefresh(`<meta http-equiv="refresh" content="0; url=/next">`)).toBeUndefined();
	});

	it("ignores documents without a refresh", () => {
		expect(extractMetaRefresh(`<meta charset="utf-8"><meta name="description" content="hi">`)).toBeUndefined();
	});
});
