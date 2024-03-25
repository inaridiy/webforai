import { BrowserWorker } from "@cloudflare/puppeteer";
import { Hono } from "hono";
import { htmlToMarkdown } from "webforai";
import { loadHtml } from "webforai/loaders/cf-puppeteer";

const app = new Hono<{
	Bindings: {
		MYBROWSER: BrowserWorker;
	};
}>();

const fetchOptions = {
	headers: {
		"User-Agent":
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
	},
};

app.get("/", async (c) => {
	const { html, url, mode = "reading" } = c.req.query();
	const _html = html ?? (await fetch(url, fetchOptions).then((res) => res.text()));
	const aiOptions = mode === "ai" ? { linkAsText: true, hideImage: true } : {};
	const markdown = htmlToMarkdown(_html, { url, ...aiOptions });
	return c.text(markdown);
});

app.get("/browser-rendering", async (c) => {
	const { url, mode = "reading" } = c.req.query();
	const html = await loadHtml(url, c.env.MYBROWSER);
	const aiOptions = mode === "ai" ? { linkAsText: true, hideImage: true } : {};
	const markdown = htmlToMarkdown(html, { url, ...aiOptions });
	return c.text(markdown);
});

export default app;
