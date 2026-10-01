/**
 * HTML→Markdown pipelines compared by `bench:compare`.
 *
 * Every pipeline is local and synchronous-equivalent: no network, no API keys. Each receives the
 * same cached HTML string and the page URL and returns a Markdown string. Configuration is the
 * minimum a typical user would apply — enough to make the output comparable (ATX headings, fenced
 * code, GFM tables), nothing tuned to this corpus.
 */

import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { NodeHtmlMarkdown } from "node-html-markdown";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { htmlToMarkdown } from "webforai";

export interface Competitor {
	id: string;
	label: string;
	/** One-line description of exactly what is run, for the report. */
	pipeline: string;
	/** Whether the pipeline tries to isolate the main content. */
	extracts: boolean;
	convert: (html: string, url: string) => string;
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
];
