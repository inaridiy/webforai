import puppeteer from "puppeteer";
import type { PuppeteerLaunchOptions } from "puppeteer";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const loadHtml = async (url: string, ctx?: PuppeteerLaunchOptions) => {
	const browser = await puppeteer.launch(
		ctx || {
			headless: true,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		},
	);
	const page = await browser.newPage();
	await page.goto(url);

	const html = await page.content();

	await Promise.race([page.waitForNetworkIdle(), sleep(10000)]);

	await browser.close();

	return html;
};
