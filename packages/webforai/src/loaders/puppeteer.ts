import puppeteer, { TimeoutError } from "puppeteer";
import type { PuppeteerLaunchOptions } from "puppeteer";

import { annotateGeometry } from "./geometry";

export const loadHtml = async (url: string, ctx?: PuppeteerLaunchOptions) => {
	const browser = await puppeteer.launch(
		ctx || {
			headless: true,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		},
	);
	try {
		const page = await browser.newPage();
		await page.goto(url);
		try {
			await page.waitForNetworkIdle({ timeout: 10000 });
		} catch (error) {
			// Analytics or long polling may prevent idleness; return the current rendered page.
			if (!(error instanceof TimeoutError)) {
				throw error;
			}
		}
		await page.evaluate(annotateGeometry);
		return await page.content();
	} finally {
		await browser.close();
	}
};
