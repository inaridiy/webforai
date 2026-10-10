/**
 * WebWalkerQA (Wu et al., arXiv:2501.07572; Apache-2.0) as a link benchmark: does a converter's
 * output still contain the link an agent has to follow next?
 *
 * Each WebWalkerQA task gives a site's root URL, the page(s) holding the answer and a golden path
 * of link labels from the root (`root->News & views->Read more`). `webwalker:fetch` follows each
 * path on the live site, resolving every label to the anchor with that text, and caches the pages
 * it clicks on; the last label must lead to the task's source page. Every click is one hop:
 * (page, URL of the next page). `webwalker:links` converts each hop's page with every pipeline and
 * checks whether the next URL appears as a link in the output.
 *
 * Fetch once (the dataset is ~1 MB; pages are rendered from the live sites, see `live-pages.ts`):
 *
 *   pnpm --filter @webforai/evals webwalker:fetch
 *
 * The same scoring runs on other link sets with `--set=` (default `webwalker`): `related-hops`
 * is built by `related-hops:build` (`cli/related-hops-build.ts`). A set lives in `.cache/<set>/`
 * (pages, `hops.jsonl`, the set's tasks, cached answers) and reports in `.reports/<set>/`.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseHTML } from "linkedom";
import type { Nodes as Mdast } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

import { CACHE_DIR, REPORTS_DIR } from "./config.js";

/** The link set the CLIs work on: `--set=`, default `webwalker`. */
export const LINK_SET = process.argv.find((value) => value.startsWith("--set="))?.slice(6) ?? "webwalker";
export const WEBWALKER_DIR = path.join(CACHE_DIR, LINK_SET);
export const LINK_REPORTS_DIR = path.join(REPORTS_DIR, LINK_SET);
export const WEBWALKER_DATA = path.join(CACHE_DIR, "gold", "webwalkerqa", "main.jsonl");
export const WEBWALKER_DATA_URL =
	"https://huggingface.co/datasets/callanwu/WebWalkerQA/resolve/main/data/main-00000-of-00001.jsonl";
export const HOPS_FILE = path.join(WEBWALKER_DIR, "hops.jsonl");

/** One line of WebWalkerQA's `main` split. */
export interface WebWalkerTask {
	question: string;
	answer: string;
	root_url: string;
	info: {
		domain: string;
		source_website: string[];
		golden_path: string[];
		type: string;
		difficulty_level: string;
		lang: string;
	};
}

/** One click on a golden path, resolved to URLs. */
export interface Hop {
	/** Index of the task in `main.jsonl`. */
	task: number;
	/** Which golden path of the task (multi-source tasks have two). */
	path: number;
	/** Position of the click on the path (0 = on the root page). */
	step: number;
	/** The URL requested; the page is cached under it. */
	pageUrl: string;
	/** The URL after redirects, which relative links resolve against. */
	finalUrl: string;
	/** The label the golden path gives for this click. */
	label: string;
	/** Absolute URL of the link to follow. */
	targetHref: string;
	/** `normalizeUrl(targetHref)`: what an output must link to. */
	target: string;
}

/**
 * URL identity for matching: scheme, `www.`, fragment, a trailing slash and an `index.html` are
 * ignored; the query is kept. Returns `undefined` for anything that is not an http(s) URL.
 */
export const normalizeUrl = (href: string, base: string): string | undefined => {
	let url: URL;
	try {
		url = new URL(href.trim(), base);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return undefined;
	}
	const host = url.hostname.toLowerCase().replace(/^www\./, "");
	const pathname = url.pathname.replace(/\/index\.(html?|php)$/i, "/").replace(/\/+$/, "") || "/";
	return `${host}${pathname}${url.search}`;
};

/**
 * Link-text identity: NFKC, lower case, no whitespace at all. WebWalkerQA's labels are anchor
 * text as BeautifulSoup's `get_text()` returns it, which joins child elements without spaces
 * ("GeneralOn the Dawn of…"); dropping all whitespace makes both spellings equal.
 */
export const textKey = (text: string): string => text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

export interface Anchor {
	/** The anchor's text with whitespace collapsed. */
	text: string;
	key: string;
	href: string;
	url: string;
}

/** Every `<a href>` of a page, resolved against `base`. */
export const htmlAnchors = (html: string, base: string): Anchor[] => {
	const { document } = parseHTML(html);
	const baseHref = document.querySelector("base[href]")?.getAttribute("href");
	const resolvedBase = baseHref ? new URL(baseHref, base).href : base;
	const anchors: Anchor[] = [];
	for (const element of document.querySelectorAll("a[href]")) {
		const raw = element.getAttribute("href") ?? "";
		const url = normalizeUrl(raw, resolvedBase);
		if (url) {
			const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
			anchors.push({ text, key: textKey(text), href: new URL(raw.trim(), resolvedBase).href, url });
		}
	}
	return anchors;
};

/** A link found in Markdown output, with the section of the output it sits in. */
export interface OutputLink {
	url: string;
	/** The nearest `##`/`###` heading above the link, as written (`Links`, `Related`, …). */
	section: string;
}

/**
 * Links of a Markdown document (inline, reference and autolinks), normalized against `base`. Also
 * any `](url)` the parser does not accept as a link — Turndown writes link text with blank lines
 * inside the brackets, which CommonMark reads as text, but a model reading the output still sees
 * the URL. Those get the section `""`.
 */
export const markdownLinks = (markdown: string, base: string): OutputLink[] => {
	const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
	const definitions = new Map<string, string>();
	const found: { href: string; section: string }[] = [];
	let section = "";
	const visit = (node: Mdast): void => {
		if (node.type === "heading" && node.depth <= 3) {
			section = plainText(node);
		}
		if (node.type === "definition") {
			definitions.set(node.identifier, node.url);
		}
		if (node.type === "link") {
			found.push({ href: node.url, section });
		}
		if (node.type === "linkReference") {
			found.push({ href: `ref:${node.identifier}`, section });
		}
		if ("children" in node) {
			for (const child of node.children) {
				visit(child as Mdast);
			}
		}
	};
	visit(tree);
	for (const match of markdown.matchAll(/\]\(\s*<?([^\s)>]+)/g)) {
		found.push({ href: match[1], section: "" });
	}
	const links: OutputLink[] = [];
	for (const { href, section: where } of found) {
		const resolved = href.startsWith("ref:") ? definitions.get(href.slice(4)) : href;
		const url = resolved ? normalizeUrl(resolved, base) : undefined;
		if (url) {
			links.push({ url, section: where });
		}
	}
	return links;
};

const plainText = (node: Mdast): string =>
	"value" in node && typeof node.value === "string"
		? node.value
		: "children" in node
			? node.children.map((child) => plainText(child as Mdast)).join("")
			: "";

export const loadTasks = async (): Promise<WebWalkerTask[]> =>
	(await readFile(WEBWALKER_DATA, "utf8"))
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as WebWalkerTask);

/** English tasks: `lang` is `en`, or empty (those are English sites too). */
export const isEnglish = (task: WebWalkerTask): boolean => task.info.lang === "en" || task.info.lang === "";

export interface CachedPage {
	url: string;
	/** When the page was rendered (pages cached before this field existed lack it). */
	fetchedAt?: string;
	finalUrl: string;
	status: number;
	contentType: string;
	html: string;
	error?: string;
}

const pageFile = (url: string): string =>
	path.join(WEBWALKER_DIR, "html", `${createHash("sha1").update(url).digest("hex")}.json`);

export const readPage = async (url: string): Promise<CachedPage | undefined> => {
	try {
		return JSON.parse(await readFile(pageFile(url), "utf8")) as CachedPage;
	} catch {
		return undefined;
	}
};

export const writePage = async (page: CachedPage): Promise<void> => {
	await mkdir(path.dirname(pageFile(page.url)), { recursive: true });
	await writeFile(pageFile(page.url), JSON.stringify(page));
};

export const loadHops = async (): Promise<Hop[]> =>
	(await readFile(HOPS_FILE, "utf8"))
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as Hop);

/** What the next-link choice needs from a task, whatever set it comes from. */
export interface NavTask {
	question: string;
	/** Pages holding the answer: choosing one of them directly is also correct. */
	sources: string[];
	/** The task's site, for bootstrapping over sites. */
	site: string;
}

/** One line of a related-hops `tasks.jsonl` (`related-hops:build`). */
export interface RelatedTask {
	id: string;
	/** Host of the start page. */
	site: string;
	/** Start page (P0), as requested. */
	pageUrl: string;
	/** The link to follow (P1), absolute, and normalized. */
	targetHref: string;
	target: string;
	/** Anchor text of the link on P0. */
	label: string;
	/** related, read_next, prev_next_article, series or next_page (labeller's category). */
	category: string;
	question: string;
	answer: string;
	/** When P0 and P1 were rendered. */
	capturedAt: { start: string; target: string };
}

export const RELATED_TASKS_FILE = path.join(WEBWALKER_DIR, "tasks.jsonl");

export const loadRelatedTasks = async (): Promise<RelatedTask[]> =>
	(await readFile(RELATED_TASKS_FILE, "utf8"))
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as RelatedTask);

/** The current set's tasks, indexed like `Hop.task`. */
export const loadNavTasks = async (): Promise<NavTask[]> => {
	if (LINK_SET === "webwalker") {
		return (await loadTasks()).map((task) => ({
			question: task.question,
			sources: task.info.source_website,
			site: new URL(task.root_url).hostname,
		}));
	}
	return (await loadRelatedTasks()).map((task) => ({
		question: task.question,
		sources: [task.targetHref],
		site: task.site,
	}));
};
