import { type Browser, type BrowserContext, chromium } from "playwright";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const loadHtml = async (url: string, context?: BrowserContext) => {
	let _browser: Browser | null = null;
	let _context: BrowserContext;
	if (context) {
		_context = context;
	} else {
		_browser = await chromium.launch({ headless: true });
		_context = await _browser.newContext();
	}

	const page = await _context.newPage();
	await page.goto(url);
	await Promise.race([page.waitForLoadState("networkidle"), sleep(10000)]);
	const html = await page.content();
	await page.close();
	if (_browser) {
		await _browser.close();
	}
	return html;
};
