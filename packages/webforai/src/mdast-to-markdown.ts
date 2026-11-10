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
 * What makes `&` the start of a character reference: a name or a number, then `;` (`&amp;`,
 * `&#38;`, `&#x26;`). Sticky, so it is tried at one position and never scans ahead.
 */
const CHARACTER_REFERENCE = /(?:[A-Za-z][A-Za-z\d]{0,31}|#\d{1,7}|#[Xx][\dA-Fa-f]{1,6});/y;

/**
 * Removes the escapes mdast-util-to-markdown puts before every `&` that a letter or `#` follows.
 *
 * It cannot look further ahead, so each `&` of a query string became `\&`: correct Markdown, but
 * a reader of the source — a person, or a model copying the URL — sees a backslash in the
 * address. A backslash stays where a character reference would start, and where the run of
 * backslashes before the `&` is even (those are literal backslashes, not an escape). One pass
 * from `&` to `&`: each run of backslashes is counted once.
 */
const plainAmpersands = (value: string): string => {
	if (!value.includes("\\&")) {
		return value;
	}
	const parts: string[] = [];
	let copied = 0;
	for (let at = value.indexOf("&"); at >= 0; at = value.indexOf("&", at + 1)) {
		let slashes = 0;
		while (at - slashes > copied && value.charCodeAt(at - slashes - 1) === 92) {
			slashes += 1;
		}
		CHARACTER_REFERENCE.lastIndex = at + 1;
		if (slashes % 2 === 1 && !CHARACTER_REFERENCE.test(value)) {
			parts.push(value.slice(copied, at - 1));
			copied = at;
		}
	}
	parts.push(value.slice(copied));
	return parts.join("");
};

const plainText: Handle = (node, parent, state, info) =>
	plainAmpersands(defaultHandlers.text(node, parent, state, info));

/**
 * Runs a default handler with `state.safe` — which escapes link text, destinations and titles —
 * followed by {@link plainAmpersands}. Inline code inside the link is written without `safe`
 * and so is left exactly as it is.
 */
const withPlainAmpersands =
	(handle: Handle): Handle =>
	(node, parent, state, info) => {
		const safe = state.safe;
		state.safe = (input, config) => plainAmpersands(safe.call(state, input, config));
		try {
			return handle(node, parent, state, info);
		} finally {
			state.safe = safe;
		}
	};

/**
 * Default options for the `mdastToMarkdown` function.
 */
export const DEFAULT_MDAST_TO_MARKDOWN_OPTIONS: MdastToMarkdownOptions = {
	// Unaligned table cells: padding every cell to its column's widest one repeats a long cell's
	// width on every row, which spends tokens on nothing but spaces.
	extensions: [gfmToMarkdown({ tablePipeAlign: false }), mathToMarkdown()],
	bullet: "-",
	// Text, destinations and titles only: code is written verbatim and never passes through `safe`.
	handlers: {
		text: plainText,
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
