import type { Nodes as Hast } from "hast";
import { type HtmlToMdastOptions, htmlToMdast } from "./html-to-mdast";
import { type MdastToMarkdownOptions, mdastToMarkdown } from "./mdast-to-markdown";

export interface HtmlToMarkdownOptions extends HtmlToMdastOptions {
	/** The base URL to use for replacing relative links. */
	baseUrl?: string;
	/** Formatting options passed to [mdast-util-to-markdown](https://github.com/syntax-tree/mdast-util-to-markdown). */
	formatting?: Omit<MdastToMarkdownOptions, "baseUrl">;
}

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
export const htmlToMarkdown = (htmlOrHast: string | Hast, options?: HtmlToMarkdownOptions): string => {
	const { baseUrl, formatting: toMarkdownOptions, ...toMdastOptions } = options || {};
	const mdast = htmlToMdast(htmlOrHast, toMdastOptions);
	const markdown = mdastToMarkdown(mdast, { baseUrl, ...toMarkdownOptions });
	return markdown;
};
