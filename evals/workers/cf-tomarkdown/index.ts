interface ConversionResult {
	format: "markdown" | "text" | "error";
	data?: string;
	error?: string;
	tokens?: number;
}

interface Env {
	// biome-ignore lint/style/useNamingConvention: binding name from wrangler.jsonc
	AI: {
		toMarkdown: (files: { name: string; blob: Blob }[]) => Promise<ConversionResult[]>;
	};
}

/** POST raw HTML; returns { ok, markdown, error, tokens, ms } with `ms` measured around the binding call. */
// biome-ignore lint/style/noDefaultExport: a Worker's entry point is its default export
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method !== "POST") {
			return new Response("POST HTML to convert it", { status: 405 });
		}
		const html = await request.text();
		const start = Date.now();
		try {
			// Defaults only, like every other pipeline: no cssSelector, no hostname.
			const [result] = await env.AI.toMarkdown([{ name: "page.html", blob: new Blob([html], { type: "text/html" }) }]);
			const ok = result?.format === "markdown";
			return Response.json({
				ok,
				markdown: ok ? result.data ?? "" : "",
				error: ok ? undefined : result?.error ?? "no result",
				tokens: result?.tokens,
				ms: Date.now() - start,
			});
		} catch (error) {
			return Response.json({ ok: false, markdown: "", error: (error as Error).message, ms: Date.now() - start });
		}
	},
};
