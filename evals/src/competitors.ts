/**
 * HTML→Markdown pipelines compared by `bench:compare`.
 *
 * Every pipeline is local and synchronous-equivalent: no network, no API keys. Each receives the
 * same cached HTML string and the page URL and returns a Markdown string. Configuration is the
 * minimum a typical user would apply — enough to make the output comparable (ATX headings, fenced
 * code, GFM tables), nothing tuned to this corpus.
 */

import { Readability } from "@mozilla/readability";
import { Defuddle } from "defuddle/node";
import { JSDOM, VirtualConsole } from "jsdom";
import { parseHTML } from "linkedom";
import { NodeHtmlMarkdown } from "node-html-markdown";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { htmlToMarkdown } from "webforai";

import { cfToMarkdown, readCfToMarkdownRecord } from "./cf-tomarkdown.js";
import { firecrawlMarkdown, readFirecrawlRecord } from "./firecrawl.js";

export interface Competitor {
	id: string;
	label: string;
	/** One-line description of exactly what is run, for the report. */
	pipeline: string;
	/** Whether the pipeline tries to isolate the main content. */
	extracts: boolean;
	/** May be async: Defuddle's Node entry point returns a promise even when it does no I/O. */
	convert: (html: string, url: string) => string | Promise<string>;
	/**
	 * For a pipeline that runs as a service and is read from a cache: the time the service took for
	 * this page, reported instead of the (meaningless) time to read the cache.
	 */
	serviceMs?: (html: string) => number;
}

/** Turndown configured the way its README and most integrations do for GFM output. */
const createTurndown = (): TurndownService => {
	const service = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
	});
	service.use(gfm);
	return service;
};

const readabilityTurndown = createTurndown();

/**
 * Full-page turndown drops elements whose text is never content. Without this, stylesheet and
 * script source is emitted as prose, which would make the baseline a straw man.
 */
const fullPageTurndown = createTurndown();
fullPageTurndown.remove(["head", "script", "style", "noscript", "template"]);

const readabilityToMarkdown = (html: string, url: string): string => {
	// A silent virtual console: jsdom otherwise prints a warning for every unparseable stylesheet.
	// Scripts are not executed and subresources are not loaded (jsdom's defaults).
	const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
	try {
		const article = new Readability(dom.window.document).parse();
		if (!article?.content) {
			// Readability returns null when it finds no candidate; the pipeline then has nothing to emit.
			return "";
		}
		const body = readabilityTurndown.turndown(article.content);
		// Readability returns the title separately (and demotes in-content h1s), so pipelines built
		// on it put the title back as the document heading.
		const title = article.title?.trim();
		return title ? `# ${title}\n\n${body}` : body;
	} finally {
		dom.window.close();
	}
};

/**
 * Defuddle as its README runs it in Node: a linkedom document passed to `defuddle/node` with
 * `markdown: true`. `useAsync` is off so no extractor reaches a third-party API (YouTube
 * transcripts, for one) — every pipeline here converts the same HTML offline. All other options
 * are Defuddle's defaults.
 */
const defuddleToMarkdown = async (html: string, url: string): Promise<string> => {
	const { document } = parseHTML(html);
	const result = await Defuddle(document as unknown as Document, url, { markdown: true, useAsync: false });
	// Defuddle, like Readability, returns the title separately.
	const title = result.title?.trim();
	return title ? `# ${title}\n\n${result.content}` : result.content;
};

export const COMPETITORS: Competitor[] = [
	{
		id: "webforai",
		label: "webforai",
		pipeline: "htmlToMarkdown(html, { baseUrl: url, url }) — default extractors (auto: site adapters + generic)",
		extracts: true,
		convert: (html, url) => htmlToMarkdown(html, { baseUrl: url, url }),
	},
	{
		id: "readability-turndown",
		label: "Readability + Turndown",
		pipeline:
			"jsdom → @mozilla/readability parse() → turndown (atx, fenced, gfm plugin) on article.content, title prepended as h1",
		extracts: true,
		convert: readabilityToMarkdown,
	},
	{
		id: "defuddle",
		label: "Defuddle",
		pipeline:
			"linkedom parseHTML → defuddle/node Defuddle(document, url, { markdown: true, useAsync: false }); title prepended as h1",
		extracts: true,
		convert: defuddleToMarkdown,
	},
	{
		id: "turndown",
		label: "Turndown (full page)",
		pipeline: "turndown (atx, fenced, gfm plugin) on the whole document; head/script/style/noscript/template removed",
		extracts: false,
		convert: (html) => fullPageTurndown.turndown(html),
	},
	{
		id: "node-html-markdown",
		label: "node-html-markdown (full page)",
		pipeline: "NodeHtmlMarkdown.translate(html) on the whole document, default options",
		extracts: false,
		convert: (html) => NodeHtmlMarkdown.translate(html),
	},
	{
		id: "firecrawl-oss",
		label: "Firecrawl OSS",
		pipeline:
			"self-hosted Firecrawl (open source) POST /v2/scrape { formats: [markdown], onlyMainContent: true } on the same HTML served locally; output cached by `firecrawl-oss`",
		extracts: true,
		convert: (html) => firecrawlMarkdown(html),
		serviceMs: (html) => readFirecrawlRecord(html).ms,
	},
	{
		id: "cf-tomarkdown",
		label: "Cloudflare toMarkdown",
		pipeline:
			"Cloudflare Workers AI env.AI.toMarkdown([{ name: page.html, blob }]) with default options (drops script/style/header/footer, appends JSON-LD); output cached by `cf-tomarkdown`",
		// It removes <header>/<footer> but does not look for the main content.
		extracts: false,
		convert: (html) => cfToMarkdown(html),
		serviceMs: (html) => readCfToMarkdownRecord(html).ms,
	},
];
