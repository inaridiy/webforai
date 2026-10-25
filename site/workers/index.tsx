import { ImageResponse } from "@cloudflare/pages-plugin-vercel-og/api";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { z } from "zod";

const fetchImage = async (env: Env, url: string) => {
	const res = await env.ASSETS.fetch(url).then((r) => (r.status !== 404 ? r : fetch(url)));

	const contentType = res.headers.get("Content-Type") || "application/octet-stream";
	const arrayBuffer = await res.arrayBuffer();
	const base64String = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
	const dataURL = `data:${contentType};base64,${base64String}`;

	return dataURL;
};

// biome-ignore lint/style/useNamingConvention: library definition
type SiteEnv = { Bindings: Env };

const app = new Hono<SiteEnv>().get(
	"/api/ogp",
	zValidator(
		"query",
		z.object({ logo: z.string().optional(), title: z.string().optional(), description: z.string().optional() }),
	),
	async (c) => {
		const { logo, title, description } = c.req.valid("query");

		const logoDataUrl = logo && (await fetchImage(c.env, logo));

		return new ImageResponse(
			<div
				style={{
					height: "100%",
					width: "100%",
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					backgroundColor: "#232225",
					color: "white",
					padding: "80px",
				}}
			>
				{/* biome-ignore lint/a11y/useAltText: */}
				{logoDataUrl && <img src={logoDataUrl} height="120px" style={{ marginTop: 48 }} />}
				<div style={{ fontSize: "42px", fontWeight: "bold", marginTop: 48, marginBottom: -12 }}>{title}</div>
				{description && <div style={{ opacity: 0.8, fontSize: "32px", marginTop: 24 }}>{description}</div>}
			</div>,
			{
				width: 1200,
				height: 630,
			},
		);
	},
);

/**
 * Unknown paths: the static 404 page that `scripts/postbuild.mjs` writes, with a real 404
 * status. The asset is requested as `/404` because `html_handling` redirects `/404.html` to it.
 */
const notFoundPage = async (c: Context<SiteEnv>) => {
	const page = await c.env.ASSETS.fetch(new URL("/404", c.req.url).toString());
	if (!page.ok) {
		return c.text("404 Not Found", 404);
	}
	return new Response(page.body, {
		status: 404,
		headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
	});
};

/** q-value of an exact media type in an `Accept` header; 0 when it is not listed. */
const qualityOf = (accept: string, type: string) => {
	for (const range of accept.split(",")) {
		const [media, ...params] = range.split(";").map((part) => part.trim().toLowerCase());
		if (media === type) {
			const q = params.find((param) => param.startsWith("q="));
			return q ? Number(q.slice(2)) || 0 : 1;
		}
	}
	return 0;
};

/** Agents ask for Markdown first: Claude Code's WebFetch sends `text/markdown, text/html, *\/*`. */
const prefersMarkdown = (accept = "") => {
	const markdown = qualityOf(accept, "text/markdown");
	return markdown > 0 && markdown >= qualityOf(accept, "text/html");
};

/** `/` → `/index.md`; `/cli` and `/cli/` → `/cli.md` — the twins `scripts/postbuild.mjs` writes. */
const markdownPathOf = (pathname: string) => {
	const route = pathname.replace(/\/+$/u, "");
	return route === "" ? "/index.md" : `${route}.md`;
};

/**
 * Page routes (`run_worker_first` in wrangler.toml sends every path without a dot here):
 * content negotiation between a page and its Markdown twin. Both answers carry `Vary: Accept`
 * so a cache never hands an agent's Markdown to a browser.
 */
app.get("*", async (c) => {
	if (prefersMarkdown(c.req.header("accept"))) {
		const twin = await c.env.ASSETS.fetch(new URL(markdownPathOf(c.req.path), c.req.url).toString());
		if (twin.ok) {
			return new Response(twin.body, {
				headers: {
					"content-type": "text/markdown; charset=utf-8",
					"cache-control": "public, max-age=300",
					vary: "Accept",
				},
			});
		}
	}
	const asset = await c.env.ASSETS.fetch(c.req.raw);
	if (asset.status === 404) {
		return notFoundPage(c);
	}
	const response = new Response(asset.body, asset);
	response.headers.append("vary", "Accept");
	return response;
});

app.notFound(notFoundPage);

// biome-ignore lint/style/noDefaultExport: worker
export default app;

// https://webforai.dev/ogp?logo=https://webforai.dev/images/logo-dark.png&title=Getting%20Started&description=hoge
