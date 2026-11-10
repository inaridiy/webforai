import type { Nodes as Mdast, RootContent } from "mdast";

import { gfmToMarkdown } from "mdast-util-gfm";
import { mathToMarkdown } from "mdast-util-math";
import { type Handle, type Options as ToMarkdownOptions, defaultHandlers, toMarkdown } from "mdast-util-to-markdown";

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
 * A backslash before `&` that no parser needs: `&` starts a character reference only when a name
 * or a number and then `;` follow (`&amp;`, `&#38;`, `&#x26;`).
 */
const NEEDLESS_AMPERSAND_ESCAPE = /(\\+)&(?!(?:[A-Za-z][A-Za-z\d]*|#\d+|#[Xx][\dA-Fa-f]+);)/g;

/**
 * Removes the escapes mdast-util-to-markdown puts before every `&` that a letter or `#` follows.
 *
 * It cannot look further ahead, so each `&` of a query string became `\&`: correct Markdown, but
 * a reader of the source — a person, or a model copying the URL — sees a backslash in the
 * address. Only an odd run of backslashes ends in an escape; an even run is literal backslashes
 * and stays.
 */
const plainAmpersands = (value: string): string =>
	value.replace(NEEDLESS_AMPERSAND_ESCAPE, (match, slashes: string) =>
		slashes.length % 2 === 1 ? `${slashes.slice(1)}&` : match,
	);

const withPlainAmpersands =
	(handle: Handle): Handle =>
	(node, parent, state, info) =>
		plainAmpersands(handle(node, parent, state, info));

/**
 * Default options for the `mdastToMarkdown` function.
 */
export const DEFAULT_MDAST_TO_MARKDOWN_OPTIONS: MdastToMarkdownOptions = {
	// Unaligned table cells: padding every cell to its column's widest one repeats a long cell's
	// width on every row, which spends tokens on nothing but spaces.
	extensions: [gfmToMarkdown({ tablePipeAlign: false }), mathToMarkdown()],
	bullet: "-",
	// Text and destinations only: code is written verbatim and never passes through here.
	handlers: {
		text: withPlainAmpersands(defaultHandlers.text),
		link: withPlainAmpersands(defaultHandlers.link),
		image: withPlainAmpersands(defaultHandlers.image),
		definition: withPlainAmpersands(defaultHandlers.definition),
	},
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

	const tree = warpRoot(mdast);
	return toMarkdown(baseUrl ? linkReplacer(tree, baseUrl) : tree, toMarkdownOptions);
};
