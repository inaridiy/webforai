import puppeteer from "@cloudflare/puppeteer";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const loadHtml = async (url: string, ctx: puppeteer.BrowserWorker) => {
	const browser = await puppeteer.launch(ctx);
	const page = await browser.newPage();
	await page.goto(url);

	const html = await page.content();

	await Promise.race([page.waitForNetworkIdle(), sleep(10000)]);

	await page.close();

	return html;
};
