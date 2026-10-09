// @ts-check
/**
 * Post-build step for the docs site, run by `pnpm build` after `vocs build`.
 *
 * For every prerendered page in `docs/dist` it:
 *
 * - fixes the head vocs emits: `og:url` is the site root on every page and the generated OG
 *   image URL carries an unencoded query string; adds a canonical link and a
 *   `rel="alternate" type="text/markdown"` link to the page's Markdown twin;
 * - converts the page **with webforai itself** (dogfooding, like the platform's
 *   `scripts/prerender.ts`) into `/<path>.md` — `/cli` → `/cli.md`, `/` → `/index.md`;
 *
 * then writes `/llms.txt` (llmstxt.org index of those Markdown files), `/llms-full.txt`
 * (all of them concatenated), `/sitemap.xml`, `/robots.txt` with its `Sitemap:` line and a
 * static `/404.html` that the Worker serves for unknown paths.
 *
 * It doubles as a build gate: a page whose extracted Markdown is near-empty or lacks the page's
 * title fails the build, so a conversion regression in webforai (or a layout change in vocs)
 * cannot silently ship empty Markdown to agents.
 *
 * Needs the workspace `webforai` package built (`pnpm --filter webforai build`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { htmlToMarkdownWithMetadata } from "webforai";

const ORIGIN = "https://webforai.dev";
const SITE_TITLE = "webforai";
const SITE_SUMMARY =
	"Convert web pages and local HTML to clean, LLM-ready Markdown — a TypeScript library (`webforai` on npm), the `@webforai/cli` CLI (`npx @webforai/cli`), and a hosted crawl/scrape API (webforai platform).";
const TITLE_SUFFIX = / – Webforai$/u;

const siteDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(siteDir, "docs", "dist");

/**
 * llms.txt sections, in reading order. Routes are matched by prefix; the first match wins.
 * `minChars` is the extraction gate: below it the page converted to a shell.
 */
const SECTIONS = [
	{ title: "Docs", match: (/** @type {string} */ route) => !/^\/(docs|cookbook|platform)(\/|$)/u.test(route) },
	{ title: "Library API reference", match: (/** @type {string} */ route) => route.startsWith("/docs/") },
	{ title: "Hosted platform", match: (/** @type {string} */ route) => /^\/platform(\/|$)/u.test(route) },
	{ title: "Cookbook", match: (/** @type {string} */ route) => /^\/cookbook(\/|$)/u.test(route) },
];
const ORDER = [
	"/getting-started",
	"/installation",
	"/how-it-works",
	"/cli",
	"/platform",
	"/platform/api-reference",
	"/platform/client",
	"/platform/billing",
];
const MIN_BODY_CHARS = 300;
/** The landing page is mostly interactive components; its static text is short by design. */
const MIN_BODY_CHARS_BY_ROUTE = { "/": 100 };

/** @param {string} value */
const decodeEntities = (value) =>
	value
		.replaceAll("&quot;", '"')
		.replaceAll("&#x27;", "'")
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");

/** @param {string} value */
const escapeAttribute = (value) =>
	value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** @param {string} value */
const escapeXml = (value) => escapeAttribute(value).replaceAll("'", "&apos;");

/** @param {string} dir @returns {string[]} */
const findPages = (dir) => {
	/** @type {string[]} */
	const found = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory() && entry.name !== "assets" && entry.name !== "images") {
			found.push(...findPages(full));
		} else if (entry.isFile() && entry.name === "index.html") {
			found.push(full);
		}
	}
	return found;
};

/** @param {string} file */
const routeOf = (file) => {
	const relative = path.relative(distDir, path.dirname(file)).split(path.sep).join("/");
	return relative === "" ? "/" : `/${relative}`;
};

/** `/` → `/index.md`, `/platform/billing` → `/platform/billing.md`. @param {string} route */
const markdownPathOf = (route) => (route === "/" ? "/index.md" : `${route}.md`);

/** @param {string} html @param {RegExp} pattern */
const firstMatch = (html, pattern) => {
	const match = pattern.exec(html);
	return match?.[1] === undefined ? undefined : decodeEntities(match[1]);
};

/**
 * Rewrites one `<meta ... content="...">` (identified by `attribute="key"`) — or reports that
 * vocs stopped emitting it, so the build does not silently lose the fix.
 * @param {string} html @param {string} attribute @param {string} key @param {(content: string) => string} rewrite
 */
const rewriteMeta = (html, attribute, key, rewrite) => {
	const pattern = new RegExp(`(<meta[^>]*\\b${attribute}="${key}"[^>]*\\bcontent=")([^"]*)(")`, "u");
	if (!pattern.test(html)) {
		throw new Error(`postbuild: <meta ${attribute}="${key}"> not found — did the vocs head change?`);
	}
	return html.replace(
		pattern,
		(_all, before, content, after) => `${before}${escapeAttribute(rewrite(decodeEntities(content)))}${after}`,
	);
};

/**
 * vocs fills `%title`/`%description` into the OG image URL unencoded (`&title=Platform Billing`).
 * Re-encode the query so the URL is valid and descriptions containing `&` survive.
 * @param {string} imageUrl
 */
const encodeOgImageUrl = (imageUrl) => {
	const [base, query] = imageUrl.split("?", 2);
	if (!query) {
		return imageUrl;
	}
	// Already encoded (a second run over the same dist): normalise without double-encoding.
	if (!/\s/u.test(query)) {
		return `${base}?${new URLSearchParams(query).toString()}`;
	}
	const match = /^logo=(.*?)&title=(.*?)&description=(.*)$/su.exec(query);
	if (!match) {
		return imageUrl;
	}
	const params = new URLSearchParams({ logo: match[1] ?? "", title: match[2] ?? "", description: match[3] ?? "" });
	return `${base}?${params.toString()}`;
};

/** @param {string} html @param {string} route */
const fixHead = (html, route) => {
	const pageUrl = `${ORIGIN}${route === "/" ? "/" : route}`;
	let out = rewriteMeta(html, "property", "og:url", () => pageUrl);
	out = rewriteMeta(out, "property", "og:image", encodeOgImageUrl);
	out = rewriteMeta(out, "property", "twitter:image", encodeOgImageUrl);
	const links = [
		`<link rel="canonical" href="${escapeAttribute(pageUrl)}"/>`,
		`<link rel="alternate" type="text/markdown" href="${escapeAttribute(markdownPathOf(route))}"/>`,
	].join("");
	if (!out.includes('rel="canonical"')) {
		out = out.replace("</head>", `${links}\n  </head>`);
	}
	return out;
};

/** @param {string} html @param {string} route */
const toMarkdown = (html, route) => {
	const url = `${ORIGIN}${route}`;
	const { markdown, metadata } = htmlToMarkdownWithMetadata(html, { url, baseUrl: url });
	const title = (firstMatch(html, /<title data-react-helmet="true">([^<]*)<\/title>/u) ?? metadata.title ?? SITE_TITLE)
		.replace(TITLE_SUFFIX, "")
		.trim();
	const description = firstMatch(html, /<meta[^>]*name="description"[^>]*content="([^"]*)"/u);
	let body = markdown.trim();
	if (!/^# /u.test(body)) {
		body = `# ${title}\n\n${body}`;
	}

	const minChars = MIN_BODY_CHARS_BY_ROUTE[/** @type {"/"} */ (route)] ?? MIN_BODY_CHARS;
	if (markdown.trim().length < minChars) {
		throw new Error(`postbuild: ${route} converted to ${markdown.trim().length} chars of Markdown (< ${minChars})`);
	}
	if (route !== "/" && !body.toLowerCase().includes(title.toLowerCase().split(" ")[0] ?? "")) {
		throw new Error(`postbuild: ${route} Markdown does not mention its title "${title}"`);
	}
	return { route, title: route === "/" ? SITE_TITLE : title, description, markdown: `${body}\n` };
};

/** @param {{ route: string }} a @param {{ route: string }} b */
const byReadingOrder = (a, b) => {
	const rank = (/** @type {string} */ route) => {
		const index = ORDER.indexOf(route);
		return index === -1 ? ORDER.length : index;
	};
	return rank(a.route) - rank(b.route) || a.route.localeCompare(b.route);
};

/** @param {{ route: string, title: string, description?: string }[]} pages */
const renderLlmsTxt = (pages) => {
	const lines = [`# ${SITE_TITLE}`, "", `> ${SITE_SUMMARY}`, ""];
	lines.push(
		"Every page below is also served as Markdown at its URL plus `.md`; `/llms-full.txt` has all of them in one file.",
		"",
	);
	for (const section of SECTIONS) {
		const members = pages.filter((page) => page.route !== "/" && section.match(page.route)).sort(byReadingOrder);
		if (members.length === 0) {
			continue;
		}
		lines.push(`## ${section.title}`, "");
		for (const page of members) {
			const link = `- [${page.title.replace(/([[\]])/gu, "\\$1")}](${ORIGIN}${markdownPathOf(page.route)})`;
			lines.push(page.description ? `${link}: ${page.description}` : link);
		}
		lines.push("");
	}
	return `${lines.join("\n").trimEnd()}\n`;
};

/** @param {{ route: string, markdown: string }[]} pages */
const renderLlmsFullTxt = (pages) => {
	const parts = [`# ${SITE_TITLE}\n\n> ${SITE_SUMMARY}`];
	for (const section of SECTIONS) {
		for (const page of pages.filter((p) => p.route !== "/" && section.match(p.route)).sort(byReadingOrder)) {
			parts.push(`Source: ${ORIGIN}${page.route}\n\n${page.markdown.trim()}`);
		}
	}
	return `${parts.join("\n\n---\n\n")}\n`;
};

/** @param {string[]} routes */
const renderSitemap = (routes) =>
	[
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...routes.map((route) => `  <url><loc>${escapeXml(`${ORIGIN}${route}`)}</loc></url>`),
		"</urlset>",
		"",
	].join("\n");

const ROBOTS_TXT = `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`;

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>Page not found – Webforai</title>
    <link rel="icon" href="/images/logo-light.png" type="image/png" />
    <style>
      :root { color-scheme: light; --fg: #1b1b1f; --muted: #67676c; --accent: #1f8fff; --bg: #ffffff; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
        font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
      main { max-width: 32rem; padding: 2rem 1rem; text-align: center; }
      img { height: 40px; }
      h1 { font-size: 1.5rem; margin: 1.5rem 0 0.5rem; }
      p { color: var(--muted); margin: 0 0 1.5rem; }
      a { color: var(--accent); text-decoration: none; }
      a:hover { text-decoration: underline; }
      nav { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; justify-content: center; }
    </style>
  </head>
  <body>
    <main>
      <a href="/"><img src="/images/logo-full-light.svg" alt="webforai" /></a>
      <h1>Page not found</h1>
      <p>This page does not exist (anymore). One of these is probably what you were looking for:</p>
      <nav>
        <a href="/">Home</a>
        <a href="/getting-started">Getting started</a>
        <a href="/cli">CLI</a>
        <a href="/platform">Platform docs</a>
        <a href="/platform/api-reference">API reference</a>
        <a href="/llms.txt">llms.txt</a>
      </nav>
    </main>
  </body>
</html>
`;

const main = () => {
	if (!fs.existsSync(distDir)) {
		throw new Error(`postbuild: ${distDir} does not exist — run vocs build first`);
	}
	const files = findPages(distDir);
	const pages = files.map((file) => {
		const route = routeOf(file);
		const html = fs.readFileSync(file, "utf-8");
		const page = toMarkdown(html, route);
		fs.writeFileSync(file, fixHead(html, route));
		const markdownFile = path.join(distDir, ...markdownPathOf(route).split("/").filter(Boolean));
		fs.writeFileSync(markdownFile, page.markdown);
		return page;
	});

	const routes = pages.map((page) => page.route).sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
	fs.writeFileSync(path.join(distDir, "llms.txt"), renderLlmsTxt(pages));
	fs.writeFileSync(path.join(distDir, "llms-full.txt"), renderLlmsFullTxt(pages));
	fs.writeFileSync(path.join(distDir, "sitemap.xml"), renderSitemap(routes));
	fs.writeFileSync(path.join(distDir, "robots.txt"), ROBOTS_TXT);
	fs.writeFileSync(path.join(distDir, "404.html"), NOT_FOUND_HTML);

	console.info(
		`postbuild: ${pages.length} pages → .md, llms.txt, llms-full.txt, sitemap.xml (${routes.length} URLs), robots.txt, 404.html`,
	);
};

main();
