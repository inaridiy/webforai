import { describe, expect, it } from "vitest";
import { REGIONS } from "../core/regions";
import { demoBodySchema } from "./demo";
import {
	MAX_BATCH_URLS,
	MAX_CRAWL_DEPTH,
	MAX_CRAWL_PAGES,
	batchBodySchema,
	crawlBodySchema,
	playgroundBodySchema,
	scrapeBodySchema,
} from "./schemas";

const url = (index: number) => `https://example.com/${index}`;

const issuePaths = (error: { issues: { path: PropertyKey[] }[] }) => error.issues.map((issue) => issue.path.join("."));

describe("scrape body", () => {
	it("fills in the documented defaults", () => {
		const parsed = scrapeBodySchema.parse({ url: "https://example.com/a" });
		expect(parsed).toEqual({
			url: "https://example.com/a",
			engine: "auto",
			screenshot: false,
			rehostImages: false,
			region: "auto",
			respectRobotsTxt: false,
			async: false,
			convert: {},
		});
	});

	it("accepts every documented region and rejects anything else", () => {
		for (const region of REGIONS) {
			expect(scrapeBodySchema.safeParse({ url: "https://example.com/a", region }).success).toBe(true);
		}
		expect(scrapeBodySchema.safeParse({ url: "https://example.com/a", region: "antarctica" }).success).toBe(false);
	});

	it("rejects the regions withdrawn on 2026-09-24 — the proxy plan cannot honour them", () => {
		expect(REGIONS).toEqual(["auto", "jp"]);
		for (const region of ["us", "eu", "uk", "asia"]) {
			expect(scrapeBodySchema.safeParse({ url: "https://example.com/a", region }).success).toBe(false);
		}
	});

	it("rejects a screenshot on an engine that cannot take one", () => {
		const result = scrapeBodySchema.safeParse({ url: "https://example.com/a", engine: "fetch", screenshot: true });
		expect(result.success).toBe(false);
		expect(result.success === false && issuePaths(result.error)).toEqual(["screenshot"]);
	});

	it("accepts a screenshot on the browser engines and on auto (which resolves to one)", () => {
		for (const engine of ["proxy-browser", "browser", "auto"]) {
			const result = scrapeBodySchema.safeParse({ url: "https://example.com/a", engine, screenshot: true });
			expect(result.success).toBe(true);
		}
	});

	it("rejects unknown engines, non-URLs and unknown keys", () => {
		expect(scrapeBodySchema.safeParse({ url: "https://example.com", engine: "curl" }).success).toBe(false);
		expect(scrapeBodySchema.safeParse({ url: "not a url" }).success).toBe(false);
		expect(scrapeBodySchema.safeParse({ url: "https://example.com", maxDepth: 3 }).success).toBe(false);
	});

	it("accepts respectRobotsTxt as an opt-in boolean on scrape, batch and crawl", () => {
		expect(scrapeBodySchema.parse({ url: "https://example.com/a", respectRobotsTxt: true }).respectRobotsTxt).toBe(
			true,
		);
		expect(batchBodySchema.parse({ urls: [url(1)] }).respectRobotsTxt).toBe(false);
		expect(batchBodySchema.parse({ urls: [url(1)], respectRobotsTxt: true }).respectRobotsTxt).toBe(true);
		expect(crawlBodySchema.parse({ url: "https://example.com/" }).respectRobotsTxt).toBe(false);
		expect(crawlBodySchema.parse({ url: "https://example.com/", respectRobotsTxt: true }).respectRobotsTxt).toBe(true);
		expect(scrapeBodySchema.safeParse({ url: "https://example.com/a", respectRobotsTxt: "yes" }).success).toBe(false);
	});

	it("is not accepted by the public demo", () => {
		expect(demoBodySchema.safeParse({ url: "https://example.com/a", respectRobotsTxt: true }).success).toBe(false);
	});

	it("rejects an unknown extractor preset", () => {
		expect(
			scrapeBodySchema.safeParse({ url: "https://example.com", convert: { extractor: "readability" } }).success,
		).toBe(false);
	});
});

describe("playground body", () => {
	it("fills in the same defaults as the scrape body but without async", () => {
		const parsed = playgroundBodySchema.parse({ url: "https://example.com/a" });
		expect(parsed).toEqual({
			url: "https://example.com/a",
			engine: "auto",
			screenshot: false,
			rehostImages: false,
			region: "auto",
			respectRobotsTxt: false,
			convert: {},
		});
	});

	it("rejects the async flag — the playground is sync-only", () => {
		expect(playgroundBodySchema.safeParse({ url: "https://example.com/a", async: true }).success).toBe(false);
		expect(playgroundBodySchema.safeParse({ url: "https://example.com/a", async: false }).success).toBe(false);
	});

	it("rejects a screenshot on an engine that cannot take one", () => {
		const result = playgroundBodySchema.safeParse({
			url: "https://example.com/a",
			engine: "fetch",
			screenshot: true,
		});
		expect(result.success).toBe(false);
		expect(result.success === false && issuePaths(result.error)).toEqual(["screenshot"]);
	});

	it("accepts a screenshot on the browser engines", () => {
		for (const engine of ["proxy-browser", "browser"]) {
			expect(playgroundBodySchema.safeParse({ url: "https://example.com/a", engine, screenshot: true }).success).toBe(
				true,
			);
		}
	});
});

describe("batch body", () => {
	it("accepts 1..100 URLs", () => {
		expect(batchBodySchema.safeParse({ urls: [url(1)] }).success).toBe(true);
		const full = Array.from({ length: MAX_BATCH_URLS }, (_, index) => url(index));
		expect(batchBodySchema.safeParse({ urls: full }).success).toBe(true);
	});

	it("rejects an empty list and more than 100 URLs", () => {
		expect(batchBodySchema.safeParse({ urls: [] }).success).toBe(false);
		const tooMany = Array.from({ length: MAX_BATCH_URLS + 1 }, (_, index) => url(index));
		const result = batchBodySchema.safeParse({ urls: tooMany });
		expect(result.success).toBe(false);
		expect(result.success === false && issuePaths(result.error)).toEqual(["urls"]);
	});

	it("rejects a screenshot on the fetch engine, but not on the auto default", () => {
		expect(batchBodySchema.safeParse({ urls: [url(1)], engine: "fetch", screenshot: true }).success).toBe(false);
		expect(batchBodySchema.safeParse({ urls: [url(1)], screenshot: true }).success).toBe(true);
	});
});

describe("crawl body", () => {
	it("applies the documented depth and page defaults", () => {
		const parsed = crawlBodySchema.parse({ url: "https://docs.example.com/" });
		expect(parsed.maxDepth).toBe(2);
		expect(parsed.limit).toBe(50);
		expect(parsed.sameOrigin).toBe(true);
	});

	it("rejects a depth above the cap and a non-integer depth", () => {
		expect(crawlBodySchema.safeParse({ url: "https://a.example.com/", maxDepth: MAX_CRAWL_DEPTH }).success).toBe(true);
		const tooDeep = crawlBodySchema.safeParse({ url: "https://a.example.com/", maxDepth: MAX_CRAWL_DEPTH + 1 });
		expect(tooDeep.success).toBe(false);
		expect(tooDeep.success === false && issuePaths(tooDeep.error)).toEqual(["maxDepth"]);
		expect(crawlBodySchema.safeParse({ url: "https://a.example.com/", maxDepth: 1.5 }).success).toBe(false);
	});

	it("rejects a page limit above the cap and below one", () => {
		expect(crawlBodySchema.safeParse({ url: "https://a.example.com/", limit: MAX_CRAWL_PAGES }).success).toBe(true);
		expect(crawlBodySchema.safeParse({ url: "https://a.example.com/", limit: MAX_CRAWL_PAGES + 1 }).success).toBe(
			false,
		);
		expect(crawlBodySchema.safeParse({ url: "https://a.example.com/", limit: 0 }).success).toBe(false);
	});

	it("refuses to pretend a cross-origin crawl was accepted", () => {
		expect(crawlBodySchema.safeParse({ url: "https://a.example.com/", sameOrigin: false }).success).toBe(false);
	});
});
