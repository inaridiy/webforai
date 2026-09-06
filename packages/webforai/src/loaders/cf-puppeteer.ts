import puppeteer, { TimeoutError } from "@cloudflare/puppeteer";

export const loadHtml = async (url: string, ctx: puppeteer.BrowserWorker) => {
	const browser = await puppeteer.launch(ctx);
	try {
		const page = await browser.newPage();
		await page.goto(url);
		try {
			await page.waitForNetworkIdle({ timeout: 10000 });
		} catch (error) {
			if (!(error instanceof TimeoutError)) {
				throw error;
			}
		}
		return await page.content();
	} finally {
		await browser.close();
	}
};
