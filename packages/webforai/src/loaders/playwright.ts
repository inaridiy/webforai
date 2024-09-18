import { type Browser, type BrowserContext, chromium } from "playwright";

export type LoadHtmlOptions = {
	context?: BrowserContext | Browser;
	timeout?: number;
	waitUntil?: "load" | "domcontentloaded" | "networkidle";
	superBypassMode?: boolean;
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
export const loadHtml = async (url: string, contextOrOptions?: BrowserContext | Browser | LoadHtmlOptions) => {
	const { context } = contextOrOptions && "page" in contextOrOptions ? { context: contextOrOptions } : contextOrOptions;
	const _context = context ?? (await chromium.launch({ headless: true }));

	const page = await _context.newPage();
	await page.goto(url, { waitUntil: "load" });
	const html = await page.content();
	await page.close();

	if (!context) {
		await _context.close();
	}

	return html;
};
