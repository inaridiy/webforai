import { ImageResponse } from "@cloudflare/pages-plugin-vercel-og/api";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

const fetchImage = async (env: Env, url: string) => {
	const res = await env.ASSETS.fetch(url);
	if (res.status !== 404) {
		return res;
	}

	const externalRes = await fetch(url);
	if (!externalRes.ok) {
		return null;
	}
	return externalRes;
};

const app = new Hono<{ Bindings: Env }>().get(
	"/api/ogp",
	zValidator(
		"query",
		z.object({ logo: z.string().optional(), title: z.string().optional(), description: z.string().optional() }),
	),
	async (c) => {
		const { logo, title, description } = c.req.valid("query");

		const logoRes = logo ? await fetchImage(c.env, logo) : null;

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
				{logo && <img src={logo} height="60px" style={{ marginTop: 48 }} />}
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
