import puppeteer from "puppeteer";
import { describe, expect, it, vi } from "vitest";
import { loadHtml } from "./puppeteer";

const examplePage = "data:text/html,<h1>Example Domain</h1>";

describe("Puppeteer loader", () => {
	it("should load the HTML of a URL", async () => {
		const html = await loadHtml(examplePage);
		expect(html).toContain("Example Domain");
	});

	it("should load the HTML of a URL using a custom puppeteer context", async () => {
		// --no-sandbox: machines with unprivileged user namespaces disabled (Ubuntu 23.10+
		// AppArmor default) cannot launch Chromium's sandbox from a test runner.
		const html = await loadHtml(examplePage, { headless: true, args: ["--no-sandbox"] });

		expect(html).toContain("Example Domain");
	});

	it("captures content rendered while waiting for the page to settle", async () => {
		const html =
			'<body><script>setTimeout(() => { document.body.textContent = "Rendered article"; }, 50)</script></body>';
		const result = await loadHtml(`data:text/html,${encodeURIComponent(html)}`);
		expect(result).toMatch(/<body[^>]*>Rendered article<\/body>/);
	});

	it("annotates every element with its rendered box", async () => {
		const html = '<body><p>Visible</p><p style="display:none">Hidden</p></body>';
		const result = await loadHtml(`data:text/html,${encodeURIComponent(html)}`);
		expect(result).toMatch(/<p data-rwidth="[1-9][\d.]*" data-rheight="[1-9][\d.]*">Visible<\/p>/);
		expect(result).toMatch(/data-rwidth="0" data-rheight="0">Hidden<\/p>/);
	});

	it("closes its browser when navigation fails", async () => {
		const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
		const launch = vi.spyOn(puppeteer, "launch").mockResolvedValueOnce(browser);
		try {
			await expect(loadHtml("invalid-url")).rejects.toThrow();
			expect(browser.connected).toBe(false);
		} finally {
			launch.mockRestore();
			await browser.close();
		}
	});
});
