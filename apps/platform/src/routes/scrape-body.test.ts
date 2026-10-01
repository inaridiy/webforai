import { describe, expect, it } from "vitest";
import { batchBodySchema, crawlBodySchema, playgroundBodySchema, scrapeBodySchema } from "./schemas";
import { parseScrapeBody } from "./scrape-body";

describe("scrape request boundary", () => {
	it.each([
		"http://169.254.169.254/",
		"http://localhost/",
		"http://127.0.0.1/",
		"http://[::1]/",
		"https://example.com:8080/",
		"https://user:secret@example.com/",
		"file:///etc/passwd",
	])("rejects %s before returning a request to the handler", async (url) => {
		for (const schema of [scrapeBodySchema, playgroundBodySchema, crawlBodySchema]) {
			await expect(parseScrapeBody(Promise.resolve({ url }), schema)).rejects.toMatchObject({
				code: "invalid_url",
				status: 400,
			});
		}
		await expect(
			parseScrapeBody(Promise.resolve({ urls: ["https://example.com", url] }), batchBodySchema),
		).rejects.toMatchObject({ code: "invalid_url", status: 400 });
	});

	it("validates all batch targets and preserves their order and request defaults", async () => {
		const urls = ["https://example.com/a", "https://example.com/b"];
		expect(await parseScrapeBody(Promise.resolve({ urls }), batchBodySchema)).toMatchObject({ urls, engine: "auto" });
	});

	it("returns actionable field paths for malformed crawl filters", async () => {
		for (const field of ["includePaths", "excludePaths"]) {
			await expect(
				parseScrapeBody(Promise.resolve({ url: "https://example.com", [field]: ["["] }), crawlBodySchema),
			).rejects.toMatchObject({
				code: "invalid_request",
				status: 400,
				message: `${field}.0: must be a valid regular expression`,
			});
		}
	});
});
