import * as playwright from "playwright";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const loadHtml = async (url: string, context?: playwright.BrowserContext) => {
	let _browser: playwright.Browser | null = null;
	let _context: playwright.BrowserContext;
	if (!context) {
		_browser = await playwright.chromium.launch();
		_context = await _browser.newContext();
	} else {
		_context = context;
	}

	const page = await _context.newPage();
	await page.goto(url);
	await Promise.race([page.waitForLoadState("networkidle"), sleep(10000)]);
	const html = await page.content();
	await page.close();
	if (_browser) await _browser.close();
	return html;
};
