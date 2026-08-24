import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { htmlToMarkdownWithMetadata } from "webforai";

/**
 * Post-build prerender of the landing page, run by `pnpm build` after `vite build`.
 *
 * Injects the server-rendered landing markup into `dist/client/index.html` so the site's
 * content exists in the raw HTML — extractable by webforai's fetch-tier engines (and any
 * crawler) without executing JavaScript. `main.tsx` hydrates the markup on `/`; an inline
 * script cleans it out before first paint on every other path, because the SPA fallback
 * serves this same file for deep links.
 *
 * The script then acts as a build gate: it converts its own output with webforai and fails
 * the build when the extracted body is (near-)empty — the exact regression that motivated
 * prerendering in the first place.
 */

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const indexPath = path.join(appDir, "dist", "client", "index.html");

/** The landing page carries well over this much prose; an extraction below it is a shell. */
const MIN_BODY_CHARS = 500;

const EMPTY_ROOT = /<div id="root">\s*<\/div>/;

const renderLandingMarkup = async (): Promise<string> => {
	const vite = await createServer({
		configFile: false,
		root: appDir,
		logLevel: "error",
		server: { middlewareMode: true },
		appType: "custom",
	});
	try {
		const entry = (await vite.ssrLoadModule("/src/client/entry-static.tsx")) as { renderLandingHtml(): string };
		return entry.renderLandingHtml();
	} finally {
		await vite.close();
	}
};

const main = async (): Promise<void> => {
	if (!fs.existsSync(indexPath)) {
		throw new Error(`prerender: ${indexPath} not found — run \`vite build\` first`);
	}
	const html = fs.readFileSync(indexPath, "utf8");
	if (!EMPTY_ROOT.test(html)) {
		throw new Error(`prerender: no empty <div id="root"> in ${indexPath} — already prerendered? Rebuild first.`);
	}

	const markup = await renderLandingMarkup();
	// The SPA fallback serves this file for every deep link; drop the landing markup before
	// first paint anywhere but "/". Runs synchronously right after the div closes.
	const clearScript = `<script>location.pathname==="/"||document.getElementById("root").replaceChildren();</script>`;
	const patched = html.replace(EMPTY_ROOT, `<div id="root">${markup}</div>${clearScript}`);

	const { markdown } = htmlToMarkdownWithMetadata(patched, { url: "https://platform.webforai.dev/" });
	const body = markdown
		.replace(/^---\n[\s\S]*?\n---\n/, "")
		.replace(/^#[^\n]*\n/, "")
		.trim();
	if (body.length < MIN_BODY_CHARS) {
		throw new Error(
			`prerender: self-extraction gate FAILED — webforai got ${body.length} chars of markdown body (< ${MIN_BODY_CHARS}) from the landing page`,
		);
	}

	fs.writeFileSync(indexPath, patched);
	console.log("prerender: landing markup injected into dist/client/index.html");
	console.log(`prerender: self-extraction gate passed (${body.length} chars of markdown body)`);
};

await main();
