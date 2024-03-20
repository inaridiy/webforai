import puppeteer from "@cloudflare/puppeteer";

export const loadHtml = async (url: string, ctx: puppeteer.BrowserWorker) => {
	const browser = await puppeteer.launch(ctx);
	const page = await browser.newPage();
	await page.goto(url);

	const html = await page.content();

	await page.close();

	return html;
};
