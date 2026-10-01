import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { htmlToMarkdownWithMetadata } from "webforai";
import type { PrerenderPath } from "../src/client/entry-static";
import type { PageMeta } from "../src/client/lib/page-meta";

/**
 * Post-build prerender of the public pages, run by `pnpm build` after `vite build`.
 *
 * Writes server-rendered markup for `/` into `dist/client/index.html`, and for each legal page
 * into its own file (`dist/client/terms.html`, …), so the content exists in the raw HTML —
 * extractable by webforai's fetch-tier engines (and any crawler) without executing
 * JavaScript. Workers static assets serve `/terms` from `terms.html` under the default
 * `html_handling: "auto-trailing-slash"`; every other path falls back to `index.html`
 * (`not_found_handling: "single-page-application"`). Each legal file gets its own `<title>`,
 * meta description, canonical URL and Open Graph URL/title/description.
 *
 * `#root` carries the route it was rendered for (`data-path`). An inline script — identical on
 * every page, so a CSP needs one hash — empties it before first paint on any other path (the
 * SPA fallback serves index.html for deep links, and the service worker's offline shell is
 * index.html too); `main.tsx` hydrates the markup when it is kept.
 *
 * The script then acts as a build gate: it converts each output with webforai and fails the
 * build when the extracted body is (near-)empty or is not the page it should be — the exact
 * regression that motivated prerendering in the first place.
 */

const ORIGIN = "https://platform.webforai.dev";
const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const clientDir = path.join(appDir, "dist", "client");
const indexPath = path.join(clientDir, "index.html");

type Page = {
	path: PrerenderPath;
	file: string;
	/** Text the extracted Markdown must contain — proves the right page was rendered. */
	marker: string;
	/** Below this many characters of Markdown body, the extraction is a shell. */
	minBodyChars: number;
};

/** Keep in sync with OWN_DOCUMENT in public/sw.js. */
const PAGES: Page[] = [
	{ path: "/", file: "index.html", marker: "Turn any web page into Markdown", minBodyChars: 500 },
	{ path: "/terms", file: "terms.html", marker: "Limitation of liability", minBodyChars: 2000 },
	{ path: "/privacy", file: "privacy.html", marker: "Information we collect", minBodyChars: 2000 },
	{ path: "/commerce", file: "commerce.html", marker: "販売事業者", minBodyChars: 300 },
];

const EMPTY_ROOT = /<div id="root">\s*<\/div>/;
/** Same bytes on every page: keep the route iff the path matches the one rendered. */
const CLEAR_SCRIPT = `<script>(function(r){(location.pathname.replace(/\\/+$/,"")||"/")===r.dataset.path||r.replaceChildren()})(document.getElementById("root"));</script>`;
const JSON_LD = /\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/;

const escapeAttribute = (value: string): string =>
	value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Replaces one attribute value of the single element matched by `selector`; fails loudly. */
const setAttribute = (html: string, selector: RegExp, value: string): string => {
	if (!selector.test(html)) {
		throw new Error(`prerender: ${selector} not found in index.html`);
	}
	return html.replace(
		selector,
		(_match, before: string, after: string) => `${before}${escapeAttribute(value)}${after}`,
	);
};

/** Title, description, canonical and Open Graph tags for a non-landing page. */
const withHead = (html: string, page: Page, meta: PageMeta, title: string): string => {
	if (meta.description === undefined) {
		throw new Error(`prerender: ${page.path} has no description in src/client/lib/page-meta.ts`);
	}
	const url = `${ORIGIN}${page.path}`;
	let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttribute(title)}</title>`);
	out = setAttribute(out, /(<meta\s+name="description"\s+content=")[^"]*(")/, meta.description);
	out = setAttribute(out, /(<link rel="canonical" href=")[^"]*(")/, url);
	out = setAttribute(out, /(<meta property="og:url" content=")[^"]*(")/, url);
	out = setAttribute(out, /(<meta property="og:title" content=")[^"]*(")/, title);
	out = setAttribute(out, /(<meta\s+property="og:description"\s+content=")[^"]*(")/, meta.description);
	// The SoftwareApplication JSON-LD describes the product; it belongs to the landing page only.
	return out.replace(JSON_LD, "");
};

type Entry = {
	renderPageHtml(path: PrerenderPath): string;
	pageMeta(path: string): PageMeta;
	documentTitle(path: string): string;
};

const loadEntry = async (): Promise<{ entry: Entry; close: () => Promise<void> }> => {
	const vite = await createServer({
		configFile: false,
		root: appDir,
		logLevel: "error",
		server: { middlewareMode: true, hmr: false, watch: null },
		appType: "custom",
	});
	const render = (await vite.ssrLoadModule("/src/client/entry-static.tsx")) as Pick<Entry, "renderPageHtml">;
	const meta = (await vite.ssrLoadModule("/src/client/lib/page-meta.ts")) as Omit<Entry, "renderPageHtml">;
	return { entry: { ...render, ...meta }, close: () => vite.close() };
};

const gate = (page: Page, html: string): number => {
	const { markdown } = htmlToMarkdownWithMetadata(html, { url: `${ORIGIN}${page.path}` });
	const body = markdown
		.replace(/^---\n[\s\S]*?\n---\n/, "")
		.replace(/^#[^\n]*\n/, "")
		.trim();
	if (body.length < page.minBodyChars) {
		throw new Error(
			`prerender: self-extraction gate FAILED — webforai got ${body.length} chars of markdown body (< ${page.minBodyChars}) from ${page.path}`,
		);
	}
	if (!markdown.includes(page.marker)) {
		throw new Error(`prerender: self-extraction gate FAILED — ${page.path} does not contain "${page.marker}"`);
	}
	return body.length;
};

const main = async (): Promise<void> => {
	if (!fs.existsSync(indexPath)) {
		throw new Error(`prerender: ${indexPath} not found — run \`vite build\` first`);
	}
	const template = fs.readFileSync(indexPath, "utf8");
	if (!EMPTY_ROOT.test(template)) {
		throw new Error(`prerender: no empty <div id="root"> in ${indexPath} — already prerendered? Rebuild first.`);
	}

	const { entry, close } = await loadEntry();
	const outputs: { page: Page; html: string }[] = [];
	try {
		for (const page of PAGES) {
			const markup = entry.renderPageHtml(page.path);
			const root = `<div id="root" data-path="${page.path}">${markup}</div>${CLEAR_SCRIPT}`;
			const head =
				page.path === "/"
					? template
					: withHead(template, page, entry.pageMeta(page.path), entry.documentTitle(page.path));
			outputs.push({ page, html: head.replace(EMPTY_ROOT, root) });
		}
	} finally {
		await close();
	}

	// Gate everything before writing anything, so a failed build leaves no half-prerendered dist.
	const sizes = outputs.map(({ page, html }) => gate(page, html));
	outputs.forEach(({ page, html }, index) => {
		fs.writeFileSync(path.join(clientDir, page.file), html);
		console.info(
			`prerender: ${page.path} → dist/client/${page.file} (self-extraction gate passed, ${sizes[index]} chars)`,
		);
	});
};

await main();
