import { describe, expect, it } from "vitest";
import { loadHtml } from "./puppeteer";

describe("Puppeteer loader", () => {
	it("should load the HTML of a URL", async () => {
		const html = await loadHtml("https://example.com");
		expect(html).toContain("Example Domain");
	});

	it("should load the HTML of a URL using a custom puppeteer context", async () => {
		// --no-sandbox: machines with unprivileged user namespaces disabled (Ubuntu 23.10+
		// AppArmor default) cannot launch Chromium's sandbox from a test runner.
		const html = await loadHtml("https://example.com", { headless: true, args: ["--no-sandbox"] });

		expect(html).toContain("Example Domain");
	});
});
