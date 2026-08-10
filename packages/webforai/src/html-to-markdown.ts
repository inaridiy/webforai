import type { Nodes as Hast } from "hast";
import { fromHtml } from "hast-util-from-html";

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
	const hast = typeof htmlOrHast === "string" ? fromHtml(htmlOrHast, { fragment: true }) : htmlOrHast;
	const isOwned = typeof htmlOrHast === "string";

	// Fragment parsing drops the `<html>` element, so a document-level `lang` has to be read from
	// the source text before it is lost.
	const declaredLang = typeof htmlOrHast === "string" ? getLangFromStr(htmlOrHast) : undefined;
	const metadata = extractMetadata(hast);
	if (declaredLang && !metadata.lang) {
		metadata.lang = declaredLang;
	}

	const mdast = htmlToMdast(hast, {
		...toMdastOptions,
		owned: isOwned,
		lang: toMdastOptions.lang ?? metadata.lang,
		url: toMdastOptions.url ?? metadata.canonicalUrl,
	});

	const body = mdastToMarkdown(mdast, { baseUrl, ...toMarkdownOptions });
	const titled = title === false ? body : withTitle(body, metadata.title);
	const markdown = frontmatter ? `${toFrontmatter(metadata)}${titled}` : titled;

	return { markdown, metadata };
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

	if (normalizeForCompare(opening).includes(normalizeForCompare(title))) {
		return body;
	}

	return `# ${title}\n\n${body}`;
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
