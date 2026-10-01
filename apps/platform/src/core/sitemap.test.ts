import { describe, expect, it } from "vitest";

import { MAX_SITEMAP_URLS, parseSitemap } from "./sitemap";

describe("parseSitemap", () => {
	it("reads page URLs from a urlset in document order, decoding entities", () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc><lastmod>2026-01-01</lastmod></url>
  <url><loc> https://example.com/a?x=1&amp;y=2 </loc></url>
  <url><loc>https://example.com/</loc></url>
</urlset>`;
		expect(parseSitemap(xml)).toEqual({
			kind: "urlset",
			urls: ["https://example.com/", "https://example.com/a?x=1&y=2"],
		});
	});

	it("recognizes a sitemap index, CDATA and namespace prefixes", () => {
		const xml = `<sm:sitemapindex xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sm:sitemap><sm:loc><![CDATA[https://example.com/s1.xml]]></sm:loc></sm:sitemap>
  <sm:sitemap><sm:loc>https://example.com/s2.xml</sm:loc></sm:sitemap>
</sm:sitemapindex>`;
		expect(parseSitemap(xml)).toEqual({
			kind: "index",
			urls: ["https://example.com/s1.xml", "https://example.com/s2.xml"],
		});
	});

	it("drops non-http and malformed locations", () => {
		const xml = "<urlset><url><loc>javascript:alert(1)</loc></url><url><loc>not a url</loc></url></urlset>";
		expect(parseSitemap(xml).urls).toEqual([]);
	});

	it("stops at the URL cap", () => {
		const entries = Array.from({ length: MAX_SITEMAP_URLS + 10 }, (_, i) => `<url><loc>https://e.com/${i}</loc></url>`);
		expect(parseSitemap(`<urlset>${entries.join("")}</urlset>`).urls).toHaveLength(MAX_SITEMAP_URLS);
	});

	it("stays linear on hostile documents", () => {
		const big = 2 * 1024 * 1024;
		for (const hostile of ["<loc>".repeat(big / 5), `<loc>${"a".repeat(big)}`, "<loc><![CDATA[".repeat(big / 14)]) {
			const started = performance.now();
			expect(parseSitemap(hostile).urls).toEqual([]);
			expect(performance.now() - started).toBeLessThan(1000);
		}
	});
});
