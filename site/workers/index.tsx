import { ImageResponse } from "@cloudflare/pages-plugin-vercel-og/api";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
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
const app = new Hono<{ Bindings: Env }>().get(
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

// biome-ignore lint/style/noDefaultExport: worker
export default app;

// https://webforai.dev/ogp?logo=https://webforai.dev/images/logo-dark.png&title=Getting%20Started&description=hoge
