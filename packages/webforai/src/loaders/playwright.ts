import { type Browser, chromium, devices } from "playwright";

export type LoadHtmlOptions = {
	browser?: Browser;
	timeout?: number;
	waitUntil?: "load" | "domcontentloaded" | "networkidle";
	superBypassMode?: boolean;
};

const SUPER_BYPASS_DEVICE = {
	userAgent:
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
	viewport: { width: 1920, height: 1080 },
	deviceScaleFactor: 1,
	hasTouch: false,
	isMobile: false,
	javaScriptEnabled: true,
	locale: "en-US",
	timezoneId: "America/New_York",
};

/**
 * Useful function for load the HTML of a URL using Playwright.
 * **Not recommended** for use in production environments.
 * @param url - The URL to load.
 * @param context - The Playwright browser context to use. If not provided, a new browser context will be created and closed after loading the URL.
 * @returns The HTML content of the URL.
 * @example
 * ```ts
 * import { loadHtml } from "webforai/loaders/playwright";
 *
 * const html = await loadHtml("https://example.com");
 * console.log(html);
 * ```
 */
export const loadHtml = async (url: string, options?: LoadHtmlOptions) => {
	const { browser, waitUntil, timeout, superBypassMode } = options ?? {};
	const _browser = browser ?? (await chromium.launch({ headless: true }));
	const context = await _browser.newContext(superBypassMode ? SUPER_BYPASS_DEVICE : devices["Desktop Chrome"]);

	if (superBypassMode) {
		await context.addInitScript(() => {
			Object.defineProperty(navigator, "webdriver", { get: () => undefined });
			Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
			Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
		});
	}

	const page = await context.newPage();
	if (superBypassMode) {
		await page.route("**/*.js", (route) => {
			if (route.request().url().includes("captcha-delivery")) {
				return route.abort();
			}
			return route.continue();
		});
	}

	await page.goto(url, { waitUntil: waitUntil ?? "load", timeout });
	const html = await page.content();
	await page.close();

	if (browser) {
		await context.close();
	} else {
		await _browser.close();
	}

	return html;
};
