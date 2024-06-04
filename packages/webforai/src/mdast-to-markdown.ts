import type { Nodes as Mdast, RootContent } from "mdast";

import { gfmToMarkdown } from "mdast-util-gfm";
import { mathToMarkdown } from "mdast-util-math";
import { type Options as ToMarkdownOptions, toMarkdown } from "mdast-util-to-markdown";

import { linkReplacer } from "./link-replacer";
import { warpRoot } from "./utils/mdast-utils";

/**
 * Options for the `mdastToMarkdown` function.
 */
export interface MdastToMarkdownOptions extends ToMarkdownOptions {
	/**
	 * The base URL to use for replacing relative links.
	 */
	baseUrl?: string;
}

/**
 * Default options for the `mdastToMarkdown` function.
 */
export const DEFAULT_MDAST_TO_MARKDOWN_OPTIONS: MdastToMarkdownOptions = {
	extensions: [gfmToMarkdown(), mathToMarkdown()],
};

/**
 * Converts an MDAST tree to a Markdown string.
 *
 * @param mdast - The MDAST tree to convert.
 * @param options - Options for the conversion.
 * @returns The Markdown string.
 *
 * @example
 * ```ts
 * import { mdastToMarkdown } from './your-library';
 *
 * const mdast = {
 *   type: 'root',
 *   children: [
 *     {
 *       type: 'paragraph',
 *       children: [
 *         { type: 'text', value: 'Hello, world!' }
 *       ]
 *     }
 *   ]
 * };
 *
 * const markdown = mdastToMarkdown(mdast);
 * console.log(markdown); // Output: "Hello, world!"
 * ```
 */
export const mdastToMarkdown = (mdast: Mdast | RootContent[], options?: MdastToMarkdownOptions): string => {
	const { baseUrl, ...toMarkdownOptions } = { ...DEFAULT_MDAST_TO_MARKDOWN_OPTIONS, ...options };

	let markdown = toMarkdown(warpRoot(mdast), toMarkdownOptions);

	if (baseUrl) {
		markdown = linkReplacer(markdown, baseUrl);
	}

	return markdown;
};
