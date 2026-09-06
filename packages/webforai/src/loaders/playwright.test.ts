import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { loadHtml } from "./playwright";

const examplePage = "data:text/html,<h1>Example Domain</h1>";

describe("Playwright loader", () => {
	it("should load the HTML of a URL", async () => {
		const html = await loadHtml(examplePage);
		expect(html).toContain("Example Domain");
	});

	it("should load the HTML of a URL using a custom context", async () => {
		const context = await chromium.launch({ headless: true });
		const html = await loadHtml(examplePage, { browser: context });

		expect(html).toContain("Example Domain");
		expect(context.isConnected()).toBe(true);
		await context.close();
	});

	it("cleans up a failed navigation without closing a caller-owned browser", async () => {
		const browser = await chromium.launch({ headless: true });
		try {
			await expect(loadHtml("invalid-url", { browser })).rejects.toThrow();
			expect(browser.contexts()).toHaveLength(0);
			expect(browser.isConnected()).toBe(true);
		} finally {
			await browser.close();
		}
	});
});
