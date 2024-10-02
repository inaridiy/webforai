import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { loadHtml } from "./puppeteer";

describe("Puppeteer loader", () => {
	it("should load the HTML of a URL", async () => {
		const html = await loadHtml("https://example.com");
		expect(html).toContain("Example Domain");
	});

	it("should load the HTML of a URL using a custom puppeteer context", async () => {
		const context = await chromium.launch({ headless: true });
		const html = await loadHtml("https://example.com", { headless: true });

		expect(html).toContain("Example Domain");
		expect(context.isConnected()).toBe(true);
		await context.close();
	});
});
