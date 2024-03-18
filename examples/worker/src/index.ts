import { Hono } from "hono";
import { htmlToMarkdown } from "webforai";

const app = new Hono();

const fetchOptions = {
	headers: {
		"User-Agent":
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
	},
};

app.get("/", async (c) => {
	const { html, url } = c.req.query();
	const _html = html ?? (await fetch(url, fetchOptions).then((res) => res.text()));
	const markdown = htmlToMarkdown(_html);
	return c.text(markdown);
});

export default app;
