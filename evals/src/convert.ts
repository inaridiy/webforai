import { type HtmlToMarkdownOptions, htmlToMarkdown } from "webforai";

import type { CorpusSite } from "./corpus.js";
import type { RenderMode } from "./fetch.js";

export interface ConversionStats {
	id: string;
	mode: RenderMode;
	url: string;
	category: string;
	htmlBytes: number;
	markdownBytes: number;
	/** Share of the source page that survived, a rough proxy for how much was stripped. */
	retention: number;
	durationMs: number;
	headings: number;
	codeBlocks: number;
	tables: number;
	images: number;
	links: number;
	/** Fraction of non-blank lines that consist solely of a link — high means navigation leaked. */
	linkOnlyLineRatio: number;
	markdown: string;
	error?: string;
}

const countMatches = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

/**
 * Fraction of lines that are nothing but a link.
 *
 * Navigation and related-post rails convert to runs of bare links, so this rises sharply when
 * boilerplate survives extraction while staying near zero for prose.
 */
const linkOnlyLineRatio = (markdown: string): number => {
	const lines = markdown.split("\n").filter((line) => line.trim().length > 0);
	if (lines.length === 0) {
		return 0;
	}
	const linkOnly = lines.filter((line) => /^\s*[-*]?\s*!?\[[^\]]*\]\([^)]*\)\s*$/.test(line)).length;
	return linkOnly / lines.length;
};

export const convert = (
	site: CorpusSite,
	mode: RenderMode,
	html: string,
	options?: HtmlToMarkdownOptions,
): ConversionStats => {
	const started = performance.now();
	let markdown = "";
	let error: string | undefined;

	try {
		markdown = htmlToMarkdown(html, { baseUrl: site.url, url: site.url, ...options });
	} catch (thrown) {
		error = (thrown as Error).message;
	}

	const durationMs = performance.now() - started;

	return {
		id: site.id,
		mode,
		url: site.url,
		category: site.category,
		htmlBytes: html.length,
		markdownBytes: markdown.length,
		retention: html.length === 0 ? 0 : markdown.length / html.length,
		durationMs,
		headings: countMatches(markdown, /^#{1,6} /gm),
		codeBlocks: countMatches(markdown, /^```/gm) / 2,
		tables: countMatches(markdown, /^\|[-: |]+\|$/gm),
		images: countMatches(markdown, /!\[[^\]]*\]\(/g),
		links: countMatches(markdown, /(?<!!)\[[^\]]*\]\(/g),
		linkOnlyLineRatio: linkOnlyLineRatio(markdown),
		markdown,
		error,
	};
};
