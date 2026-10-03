import type { Nodes as Hast } from "hast";
import { parseHtml } from "./utils/parse-html";

import type { ExtractionReport } from "./extractors";
import { type HtmlToMdastOptions, htmlToMdast } from "./html-to-mdast";
import { type MdastToMarkdownOptions, mdastToMarkdown } from "./mdast-to-markdown";
import { type PageMetadata, extractMetadata, toFrontmatter } from "./metadata";
import { getLangFromStr } from "./utils/hast-utils";

export interface HtmlToMarkdownOptions extends HtmlToMdastOptions {
	/** The base URL to use for replacing relative links. */
	baseUrl?: string;
	/**
	 * Prepend a YAML front-matter block describing the page.
	 *
	 * Metadata is read from JSON-LD, Open Graph and ordinary meta tags. Nothing is emitted when
	 * the page publishes none, so the option is safe to leave on for mixed inputs.
	 */
	frontmatter?: boolean;
	/**
	 * Prepend the page title as a top-level heading when the extracted content lacks it.
	 *
	 * Defaults to `true`. Article containers often exclude the `<h1>`, leaving the conversion to
	 * open mid-article with no indication of what the page is. Set to `false` to keep only what
	 * the extractor found.
	 */
	title?: boolean;
	/** Formatting options passed to [mdast-util-to-markdown](https://github.com/syntax-tree/mdast-util-to-markdown). */
	formatting?: Omit<MdastToMarkdownOptions, "baseUrl">;
}

export interface HtmlToMarkdownResult {
	markdown: string;
	metadata: PageMetadata;
	/**
	 * What the extractor reported: which one ran (`kiwame`, `takumi`, `adapter`) and, for the
	 * learned extractor, `confidence` — the expected token F1 of the content against the page's
	 * main content, 0–1. Low values flag pages worth a second look. Absent with custom
	 * extractors that report nothing.
	 */
	extraction?: ExtractionReport;
}

/**
 * Converts HTML or HAST to Markdown, also returning the page's metadata.
 *
 * Useful when the metadata is wanted as data rather than as front matter — for indexing, or to
 * decide what to do with a page before converting it.
 *
 * @param htmlOrHast - The HTML string or HAST tree to convert.
 * @param options - {@link HtmlToMarkdownOptions} to customize the conversion.
 *
 * @example
 * ```ts
 * import { htmlToMarkdownWithMetadata } from "webforai";
 *
 * const { markdown, metadata } = htmlToMarkdownWithMetadata(html, { url });
 * console.log(metadata.title, metadata.author);
 * ```
 */
export const htmlToMarkdownWithMetadata = (
	htmlOrHast: string | Hast,
	options?: HtmlToMarkdownOptions,
): HtmlToMarkdownResult => {
	const { baseUrl, frontmatter, title, formatting: toMarkdownOptions, ...toMdastOptions } = options || {};

	// Parsed once here rather than inside `htmlToMdast`, because metadata lives in `<head>` and
	// extraction discards it. `owned` tells the extractors they may mutate this tree in place.
	const hast = typeof htmlOrHast === "string" ? parseHtml(htmlOrHast, { fragment: true }) : htmlOrHast;
	const isOwned = typeof htmlOrHast === "string";

	// Fragment parsing drops the `<html>` element, so a document-level `lang` has to be read from
	// the source text before it is lost.
	const declaredLang = typeof htmlOrHast === "string" ? getLangFromStr(htmlOrHast) : undefined;
	const metadata = extractMetadata(hast);
	if (declaredLang && !metadata.lang) {
		metadata.lang = declaredLang;
	}

	let extraction: ExtractionReport | undefined;
	const mdast = htmlToMdast(hast, {
		...toMdastOptions,
		onExtraction: (report) => {
			extraction = report;
			toMdastOptions.onExtraction?.(report);
		},
		owned: isOwned,
		lang: toMdastOptions.lang ?? metadata.lang,
		url: toMdastOptions.url ?? metadata.canonicalUrl,
	});

	const body = mdastToMarkdown(mdast, { baseUrl, ...toMarkdownOptions });
	const pageUrl = toMdastOptions.url ?? metadata.canonicalUrl;
	const titled = title === false ? body : withTitle(body, headingTitle(metadata.title, metadata.siteName, pageUrl));
	const markdown = frontmatter ? `${toFrontmatter(metadata)}${titled}` : titled;

	return extraction ? { markdown, metadata, extraction } : { markdown, metadata };
};

/** Separators publishers put between a page's title and the site's name. */
const TITLE_SEPARATOR = /\s+[-|–—·•:]\s+|\s*[｜|]\s*/;

/** Words a site appends to its own name for a section of itself ("Svelte Docs", "WordPress News"). */
const SITE_SECTION = /^(docs|documentation|blog|news|wiki|developers?|devblog|help|support|reference)$/;

/** Lower-case letters and digits only, so "ICS MEDIA" and `ics.media` compare equal. */
const compact = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Names the page's own site goes by: its declared name and the labels of its host. */
const siteNames = (siteName: string | undefined, url: string | undefined): string[] => {
	const names = siteName ? siteName.split(TITLE_SEPARATOR).map(compact) : [];
	try {
		const labels = url ? new URL(url).hostname.split(".") : [];
		// Each label but the TLD and `www`, those joined, and the whole host joined ("icsmedia").
		const meaningful = labels.slice(0, -1).filter((label) => label !== "www");
		names.push(...meaningful.map(compact), compact(meaningful.join("")), compact(labels.join("").replace(/^www/, "")));
	} catch {
		// An unparsable URL contributes nothing.
	}
	return names.filter((name) => name.length >= 3);
};

/**
 * The page title without the site name the `<title>` element appends or prepends.
 *
 * "Euler's identity - Wikipedia" reads as a heading of the article only once " - Wikipedia" is
 * gone. A trailing segment is removed only when it is the site's name — the declared one or the
 * host's, optionally with a section word ("Svelte Docs" on svelte.dev) — so "Rick Astley - Never
 * Gonna Give You Up" on YouTube and "Guide - Docker Compose" on docs.docker.com are left alone.
 */
export const headingTitle = (title: string | undefined, siteName?: string, url?: string): string | undefined => {
	if (!title) {
		return title;
	}
	const segments = title.split(TITLE_SEPARATOR);
	if (segments.length < 2) {
		return title;
	}
	const names = siteNames(siteName, url);
	if (names.length === 0) {
		return title;
	}

	const isSite = (segment: string): boolean => {
		const value = compact(segment);
		return (
			value.length > 0 &&
			names.some((name) => value === name || (value.startsWith(name) && SITE_SECTION.test(value.slice(name.length))))
		);
	};

	const last = segments[segments.length - 1];
	if (isSite(last)) {
		return stripSegment(title, last, "end");
	}
	// A leading segment is often the product the page is about ("Hono - Web framework built on
	// Web Standards"), so only the declared site name, matched exactly, is removed there.
	if (siteName && compact(segments[0]) === compact(siteName)) {
		return stripSegment(title, segments[0], "start");
	}
	return title;
};

/** Removes a leading or trailing segment together with the separator next to it. */
const stripSegment = (title: string, segment: string, edge: "start" | "end"): string => {
	const rest = edge === "end" ? title.slice(0, title.lastIndexOf(segment)) : title.slice(segment.length);
	const trimmed = rest.replace(edge === "end" ? /[\s\-|–—·•:｜]+$/ : /^[\s\-|–—·•:｜]+/, "");
	return trimmed.length > 0 ? trimmed : title;
};

/** How far into the output to look for an existing title before adding one. */
const TITLE_LOOKAHEAD = 400;

/**
 * Prepends the page title when the extracted content does not already carry it.
 *
 * Article containers frequently exclude the `<h1>` — it sits in a `<header>` above the body, or
 * in page chrome the extractor correctly discarded — so the conversion opens mid-article with no
 * indication of what the page is about. Blinded evaluation flagged this on issue trackers,
 * newsletter posts and reference pages alike.
 *
 * The title is only added when it is genuinely absent: if the opening of the document already
 * mentions it, in a heading or otherwise, nothing is changed.
 */
const withTitle = (body: string, title: string | undefined): string => {
	if (!title) {
		return body;
	}

	const opening = body.slice(0, TITLE_LOOKAHEAD);

	// An existing top-level heading is the document's title, whatever its exact wording. Comparing
	// text instead would duplicate the heading whenever the metadata carries a site-name suffix
	// ("Window: fetch() method - Web APIs | MDN" against a "# Window: fetch() method" heading).
	// Matched anywhere in the lookahead, not only at the start: a stray breadcrumb line ahead of
	// the article's own h1 must not trigger a second title.
	if (/^#\s+\S/m.test(opening)) {
		return body;
	}

	if (mentionsTitle(opening, title)) {
		return body;
	}

	return `# ${title}\n\n${body}`;
};

/** Shorter than this, a title found inside prose is a word in a sentence, not the title. */
const MIN_EMBEDDED_TITLE_LENGTH = 24;

/**
 * True when the opening already presents the title: as a line of its own (bold, a breadcrumb,
 * a heading-styled paragraph), or — for a title long enough not to occur by chance — anywhere.
 * A short title like "Markdown" appears in the first sentence of its own article and must not
 * count as the article having a title.
 */
const mentionsTitle = (opening: string, title: string): boolean => {
	const wanted = normalizeForCompare(title);
	if (wanted.length >= MIN_EMBEDDED_TITLE_LENGTH) {
		return normalizeForCompare(opening).includes(wanted);
	}
	return opening.split("\n").some((line) => normalizeForCompare(line.replace(/[#*_`>]/g, "")) === wanted);
};

/** Case- and whitespace-insensitive comparison, so punctuation-level differences do not matter. */
const normalizeForCompare = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Converts HTML or HAST to a Markdown string.
 *
 * @param htmlOrHast - The HTML string or HAST tree to convert.
 * @param options - {@link HtmlToMarkdownOptions} to customize the conversion.
 * @returns The Markdown string.
 *
 * @example
 * ```ts
 * import { htmlToMarkdown } from "webforai"
 *
 * const html = '<h1>Hello, world!</h1>';
 * const markdown = htmlToMarkdown(html);
 *
 * console.log(markdown); // Output: "# Hello, world!"
 * ```
 */
export const htmlToMarkdown = (htmlOrHast: string | Hast, options?: HtmlToMarkdownOptions): string =>
	htmlToMarkdownWithMetadata(htmlOrHast, options).markdown;
