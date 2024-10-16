import { describe, expect, it } from "vitest";
import { loadHtml } from "./puppeteer";

describe("Puppeteer loader", () => {
	it("should load the HTML of a URL", async () => {
		const html = await loadHtml("https://example.com");
		expect(html).toContain("Example Domain");
	});

	it("should load the HTML of a URL using a custom puppeteer context", async () => {
		const html = await loadHtml("https://example.com", { headless: true });

		expect(html).toContain("Example Domain");
	});
});
