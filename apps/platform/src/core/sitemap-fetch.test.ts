import { describe, expect, it } from "vitest";

import { ALLOW_ALL, type RobotsTxt } from "./robots";
import { MAX_SITEMAP_FETCHES, createSitemapLoader } from "./sitemap-fetch";

const urlset = (...urls: string[]) => `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;
const index = (...urls: string[]) =>
	`<sitemapindex>${urls.map((u) => `<sitemap><loc>${u}</loc></sitemap>`).join("")}</sitemapindex>`;

const fakeFetch = (routes: Record<string, Response | (() => Response)>) => {
	const requested: string[] = [];
	const fetchImpl = (input: string) => {
		requested.push(input);
		const route = routes[input];
		if (!route) {
			return Promise.resolve(new Response("missing", { status: 404 }));
		}
		return Promise.resolve(typeof route === "function" ? route() : route);
	};
	return { requested, fetchImpl };
};

const robotsWith = (robots: Partial<RobotsTxt>) => () => Promise.resolve({ ...ALLOW_ALL, ...robots });
const SEED = new URL("https://example.com/docs/");

const gzip = (text: string): Promise<ArrayBuffer> =>
	new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();

describe("createSitemapLoader", () => {
	it("falls back to /sitemap.xml when robots.txt names none", async () => {
		const { fetchImpl, requested } = fakeFetch({
			"https://example.com/sitemap.xml": new Response(urlset("https://example.com/a", "https://example.com/b")),
		});

		const urls = await createSitemapLoader(robotsWith({}), fetchImpl)(SEED, 100);

		expect(urls).toEqual(["https://example.com/a", "https://example.com/b"]);
		expect(requested).toEqual(["https://example.com/sitemap.xml"]);
	});

	it("expands robots.txt sitemaps and indexes, gzip included, up to maxUrls", async () => {
		const gz = await gzip(urlset("https://example.com/c", "https://example.com/d"));
		const { fetchImpl } = fakeFetch({
			"https://example.com/index.xml": () =>
				new Response(index("https://example.com/s1.xml", "https://example.com/s2.xml.gz")),
			"https://example.com/s1.xml": () => new Response(urlset("https://example.com/a", "https://example.com/b")),
			"https://example.com/s2.xml.gz": () => new Response(gz),
		});
		const loader = createSitemapLoader(robotsWith({ sitemaps: ["https://example.com/index.xml"] }), fetchImpl);

		expect(await loader(SEED, 100)).toEqual([
			"https://example.com/a",
			"https://example.com/b",
			"https://example.com/c",
			"https://example.com/d",
		]);
		expect(await loader(SEED, 3)).toHaveLength(3);
	});

	it("contributes nothing for failing or private sitemaps instead of throwing", async () => {
		const { fetchImpl, requested } = fakeFetch({
			"https://example.com/a.xml": new Response("", { status: 302, headers: { location: "http://127.0.0.1/s.xml" } }),
			"https://example.com/b.xml": new Response("oops", { status: 500 }),
		});
		const loader = createSitemapLoader(
			robotsWith({ sitemaps: ["https://example.com/a.xml", "https://example.com/b.xml"] }),
			fetchImpl,
		);

		expect(await loader(SEED, 100)).toEqual([]);
		expect(requested).not.toContain("http://127.0.0.1/s.xml");
	});

	it("bounds the number of sitemap documents it fetches", async () => {
		const many = Array.from({ length: 20 }, (_, i) => `https://example.com/s${i}.xml`);
		const routes: Record<string, () => Response> = {
			"https://example.com/index.xml": () => new Response(index(...many)),
		};
		for (const [i, url] of many.entries()) {
			routes[url] = () => new Response(urlset(`https://example.com/p${i}`));
		}
		const { fetchImpl, requested } = fakeFetch(routes);
		await createSitemapLoader(robotsWith({ sitemaps: ["https://example.com/index.xml"] }), fetchImpl)(SEED, 1000);
		expect(requested).toHaveLength(MAX_SITEMAP_FETCHES);
	});

	it("decides on gzip by content, not by name", async () => {
		const gz = await gzip(urlset("https://example.com/g"));
		const { fetchImpl } = fakeFetch({
			// Gzipped bytes under a plain name, and an already-decoded body under a .gz name.
			"https://example.com/a.xml": () => new Response(gz),
			"https://example.com/b.xml.gz": () => new Response(urlset("https://example.com/plain")),
		});
		const loader = createSitemapLoader(
			robotsWith({ sitemaps: ["https://example.com/a.xml", "https://example.com/b.xml.gz"] }),
			fetchImpl,
		);
		expect(await loader(SEED, 100)).toEqual(["https://example.com/g", "https://example.com/plain"]);
	});
});
