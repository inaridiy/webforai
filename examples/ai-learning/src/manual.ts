import fs from "node:fs";
import dotenv from "dotenv";
import { chromium } from "playwright";
import { htmlToMarkdown } from "webforai";

dotenv.config();

const url = "https://www.wsj.com/";
const loadHtml = async (url: string) => {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		userAgent:
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
		viewport: { width: 1920, height: 1080 },
		deviceScaleFactor: 1,
		hasTouch: false,
		isMobile: false,
		javaScriptEnabled: true,
		locale: "en-US",
		timezoneId: "America/New_York",
	});

	// Webドライバーの特性を隠す
	await context.addInitScript(() => {
		Object.defineProperty(navigator, "webdriver", { get: () => undefined });
		Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
		Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
	});

	const page = await context.newPage();
	await page.route("**/*.js", (route) => {
		if (route.request().url().includes("captcha-delivery")) {
			return route.abort();
		}
		return route.continue();
	});

	await page.goto(url, { waitUntil: "networkidle", timeout: 10_000 }).catch(() => {
		/** */
	});
	const html = await page.content();
	await page.close();
	await browser.close();

	return html;
};

const html = await loadHtml(url);

await fs.writeFileSync("html.html", html);

const rawContent = await htmlToMarkdown(html, { baseUrl: url, extractors: false });
const cleanedContent = await htmlToMarkdown(html, { baseUrl: url, extractors: "readability" });

await fs.writeFileSync("raw.md", rawContent);
await fs.writeFileSync("cleaned.md", cleanedContent);
