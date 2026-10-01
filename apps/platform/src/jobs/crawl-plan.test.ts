import { describe, expect, it } from "vitest";
import { type CrawlVisit, traverseCrawl } from "./crawl-plan";

const SEED = "https://docs.example.com/";

/** A visitor over a fixed link graph, recording the visit order the traversal produced. */
const visitorOver = (graph: Record<string, string[]>) => {
	const visits: CrawlVisit[] = [];
	const visit = ({ url, index, depth }: CrawlVisit) => {
		visits.push({ url, index, depth });
		return Promise.resolve({ links: graph[url] ?? [] });
	};
	return { visits, visit };
};

describe("traverseCrawl", () => {
	it("visits breadth-first and numbers pages in visit order", async () => {
		const { visits, visit } = visitorOver({
			[SEED]: ["https://docs.example.com/a", "https://docs.example.com/b"],
			"https://docs.example.com/a": ["https://docs.example.com/a1"],
			"https://docs.example.com/b": ["https://docs.example.com/b1"],
		});

		const result = await traverseCrawl(SEED, { maxDepth: 2, limit: 50 }, visit);

		expect(result).toEqual({ visited: 5, aborted: false });
		expect(visits.map((entry) => entry.url)).toEqual([
			SEED,
			"https://docs.example.com/a",
			"https://docs.example.com/b",
			"https://docs.example.com/a1",
			"https://docs.example.com/b1",
		]);
		expect(visits.map((entry) => entry.index)).toEqual([0, 1, 2, 3, 4]);
		expect(visits.map((entry) => entry.depth)).toEqual([0, 1, 1, 2, 2]);
	});

	it("stops descending at maxDepth", async () => {
		const { visits, visit } = visitorOver({
			[SEED]: ["https://docs.example.com/a"],
			"https://docs.example.com/a": ["https://docs.example.com/a1"],
			"https://docs.example.com/a1": ["https://docs.example.com/a2"],
		});

		const result = await traverseCrawl(SEED, { maxDepth: 1, limit: 50 }, visit);

		expect(result.visited).toBe(2);
		expect(visits.map((entry) => entry.url)).toEqual([SEED, "https://docs.example.com/a"]);
	});

	it("visits the seed only when maxDepth is zero", async () => {
		const { visits, visit } = visitorOver({ [SEED]: ["https://docs.example.com/a"] });
		await traverseCrawl(SEED, { maxDepth: 0, limit: 50 }, visit);
		expect(visits.map((entry) => entry.url)).toEqual([SEED]);
	});

	it("never visits the same URL twice", async () => {
		const { visits, visit } = visitorOver({
			[SEED]: ["https://docs.example.com/a", "https://docs.example.com/a", SEED],
			"https://docs.example.com/a": [SEED, "https://docs.example.com/a"],
		});

		const result = await traverseCrawl(SEED, { maxDepth: 3, limit: 50 }, visit);

		expect(result.visited).toBe(2);
		expect(visits.map((entry) => entry.url)).toEqual([SEED, "https://docs.example.com/a"]);
	});

	it("never visits more than `limit` pages", async () => {
		const fanOut = Array.from({ length: 20 }, (_, index) => `https://docs.example.com/${index}`);
		const { visits, visit } = visitorOver({ [SEED]: fanOut });

		const result = await traverseCrawl(SEED, { maxDepth: 3, limit: 5 }, visit);

		expect(result).toEqual({ visited: 5, aborted: false });
		expect(visits).toHaveLength(5);
	});

	it("stops immediately when the visitor aborts", async () => {
		const seen: string[] = [];
		const result = await traverseCrawl(SEED, { maxDepth: 2, limit: 50 }, ({ url }) => {
			seen.push(url);
			return Promise.resolve(
				seen.length === 2 ? undefined : { links: ["https://docs.example.com/a", "https://docs.example.com/b"] },
			);
		});

		expect(result).toEqual({ visited: 2, aborted: true });
		expect(seen).toEqual([SEED, "https://docs.example.com/a"]);
	});

	it("is deterministic: identical visitor results replay the identical order", async () => {
		const graph = {
			[SEED]: ["https://docs.example.com/a", "https://docs.example.com/b"],
			"https://docs.example.com/a": ["https://docs.example.com/b", "https://docs.example.com/c"],
		};
		const first = visitorOver(graph);
		const second = visitorOver(graph);

		await traverseCrawl(SEED, { maxDepth: 2, limit: 10 }, first.visit);
		await traverseCrawl(SEED, { maxDepth: 2, limit: 10 }, second.visit);

		expect(second.visits).toEqual(first.visits);
	});

	it("queues sitemap URLs at depth 1 after the seed's own links, without duplicates", async () => {
		const { visits, visit } = visitorOver({
			[SEED]: ["https://docs.example.com/a"],
			"https://docs.example.com/a": ["https://docs.example.com/a1"],
		});

		await traverseCrawl(SEED, { maxDepth: 2, limit: 50 }, visit, {
			sitemapUrls: ["https://docs.example.com/s", "https://docs.example.com/a"],
		});

		expect(visits.map((entry) => [entry.url, entry.depth])).toEqual([
			[SEED, 0],
			["https://docs.example.com/a", 1],
			["https://docs.example.com/s", 1],
			["https://docs.example.com/a1", 2],
		]);
	});

	it("still visits sitemap URLs in sitemap-only mode when maxDepth is 0", async () => {
		const { visits, visit } = visitorOver({});
		await traverseCrawl(SEED, { maxDepth: 0, limit: 50 }, visit, {
			sitemapUrls: ["https://docs.example.com/s"],
			followLinks: false,
		});
		expect(visits.map((entry) => entry.url)).toEqual([SEED, "https://docs.example.com/s"]);
	});

	it("follows no links in sitemap-only mode", async () => {
		const { visits, visit } = visitorOver({
			[SEED]: ["https://docs.example.com/a"],
			"https://docs.example.com/s": ["https://docs.example.com/b"],
		});

		await traverseCrawl(SEED, { maxDepth: 3, limit: 50 }, visit, {
			sitemapUrls: ["https://docs.example.com/s"],
			followLinks: false,
		});

		expect(visits.map((entry) => entry.url)).toEqual([SEED, "https://docs.example.com/s"]);
	});
});
