import { DurableObject } from "cloudflare:workers";
import puppeteer from "@cloudflare/puppeteer";
import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono";
import { cache } from "hono/cache";
import { url, literal, object, optional, string, union } from "valibot";
import { htmlToMarkdown } from "webforai";

type Bindings = { MYBROWSER: puppeteer.BrowserWorker; BROWSER: DurableObjectNamespace<BrowserDO> };

const app = new Hono<{ Bindings: Bindings }>();

const BROWSER_KEYS = ["browser1", "browser2"];

const schema = object({
	url: string([url()]),
	mode: optional(union([literal("readability"), literal("ai")])),
});

app.get(
	"/",
	cache({ cacheName: "html-to-markdown", cacheControl: "max-age=3600" }),
	vValidator("query", schema),
	async (c) => {
		const { url, mode } = c.req.valid("query");

		const pickedKey = BROWSER_KEYS[Math.floor(Math.random() * BROWSER_KEYS.length)];
		const browser = c.env.BROWSER.get(c.env.BROWSER.idFromName(pickedKey));
		const result = await browser.renderUrl(url);

		if (!result.success) {
			return c.text(result.error, 500);
		}

		const aiModeOptions = { linkAsText: true, tableAsText: true, hideImage: true };
		const readabilityModeOptions = { linkAsText: false, tableAsText: false, hideImage: false };
		const markdown = htmlToMarkdown(result.html, {
			baseUrl: url,
			...(mode === "ai" ? aiModeOptions : readabilityModeOptions),
		});
		return c.text(markdown);
	},
);

// biome-ignore lint/style/noDefaultExport: This is the default export for the worker script
export default app;

const KEEP_BROWSER_ALIVE_IN_SECONDS = 60;

export class BrowserDO extends DurableObject<Bindings> {
	private browser: puppeteer.Browser | null = null;
	private keptAliveInSeconds = 0;

	async renderUrl(url: string): Promise<{ success: true; html: string } | { success: false; error: string }> {
		const normalizedUrl = new URL(url).toString();

		try {
			if (!this.browser?.isConnected()) {
				const sessions = await puppeteer.sessions(this.env.MYBROWSER);
				const freeSession = sessions.find((s) => !s.connectionId);
				if (freeSession) {
					this.browser = await puppeteer.connect(this.env.MYBROWSER, freeSession.sessionId);
				} else {
					this.browser = await puppeteer.launch(this.env.MYBROWSER);
				}
			}
		} catch (e) {
			console.error(e);
			return { success: false, error: "Failed to launch browser" };
		}

		this.keptAliveInSeconds = 0;
		const page = await this.browser.newPage();
		await page.goto(normalizedUrl, { waitUntil: "networkidle0" });

		//scriptタグを削除
		await page.evaluate(() => {
			const scripts = document.querySelectorAll("script");
			for (const script of Array.from(scripts)) {
				script.remove();
			}
		});

		const html = await page.content();

		const cleanup = async () => {
			await page.close();
			this.keptAliveInSeconds = 0;
			const currentAlarm = await this.ctx.storage.getAlarm();
			if (currentAlarm) {
				return;
			}
			const tenSeconds = 10 * 1000;
			await this.ctx.storage.setAlarm(Date.now() + tenSeconds);
		};
		this.ctx.waitUntil(cleanup());

		return { success: true, html };
	}

	async alarm() {
		this.keptAliveInSeconds += 10;
		if (this.keptAliveInSeconds < KEEP_BROWSER_ALIVE_IN_SECONDS) {
			await this.ctx.storage.setAlarm(Date.now() + 10 * 1000);
			if (this.browser?.isConnected()) {
				await this.browser.version();
			}
		} else {
			await this.browser?.close();
			this.browser = null;
		}
	}
}
