import type { Root } from "hast";

import { fromParse5 } from "hast-util-from-parse5";
import { type DefaultTreeAdapterMap, parse, parseFragment } from "parse5";
import { PLAYER_RESPONSE_VARIABLE } from "../adapters/sites/youtube";
import { CHALLENGE_PATTERN } from "../detect-client-shell";

type Parse5Node = DefaultTreeAdapterMap["node"];
type Parse5Parent = DefaultTreeAdapterMap["parentNode"];
type Parse5Child = DefaultTreeAdapterMap["childNode"];

/**
 * Deepest element nesting kept; deeper elements are unwrapped into their ancestor at this depth.
 *
 * The parser builds arbitrarily deep trees without trouble, but converting and walking them is
 * recursive throughout the unified ecosystem: 2,000 nested `<div>`s exhausted the call stack in
 * `hast-util-from-parse5` and the conversion threw. Real pages stay far below this (framework
 * markup rarely passes 60); only text is kept from anything deeper.
 */
export const MAX_ELEMENT_DEPTH = 256;

const isParent = (node: Parse5Node): node is Parse5Parent => "childNodes" in node;

/** Elements whose boundaries are line breaks; unwrapping one leaves a newline in its place. */
const LINE_ELEMENTS = new Set([
	"p",
	"div",
	"li",
	"tr",
	"td",
	"th",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"br",
	"section",
	"article",
	"pre",
	"blockquote",
]);

type Parse5Text = DefaultTreeAdapterMap["textNode"];

const textNode = (value: string, parentNode: Parse5Parent): Parse5Text =>
	({ nodeName: "#text", value, parentNode }) as Parse5Text;

/**
 * Joins runs of adjacent text nodes in one pass.
 *
 * Unwrapping thousands of deep paragraphs leaves thousands of adjacent text nodes, and the
 * Markdown conversion merges such runs pairwise, re-scanning the growing string each time —
 * quadratic, and seconds of CPU on a 200 KB page.
 */
const coalesceText = (parent: Parse5Parent): void => {
	const merged: Parse5Child[] = [];
	for (const child of parent.childNodes) {
		const previous = merged.at(-1);
		if (child.nodeName === "#text" && previous?.nodeName === "#text") {
			(previous as Parse5Text).value += (child as Parse5Text).value;
		} else {
			merged.push(child);
		}
	}
	parent.childNodes = merged;
};

/** Unwraps every element nested deeper than `maxDepth`, iteratively, in place. */
const flattenDeep = (root: Parse5Parent, maxDepth: number): void => {
	const stack: Array<[Parse5Parent, number]> = [[root, 0]];
	while (stack.length > 0) {
		const [parent, depth] = stack.pop() as [Parse5Parent, number];
		const children = parent.childNodes;
		let unwrapped = false;
		for (let index = 0; index < children.length; index++) {
			const child = children[index];
			if (!isParent(child)) {
				continue;
			}
			if (depth + 1 > maxDepth && "tagName" in child) {
				// Replace the element by its children and look at the same position again.
				const replacement: Parse5Child[] = [...child.childNodes];
				if (LINE_ELEMENTS.has(child.tagName)) {
					replacement.unshift(textNode("\n", parent));
					replacement.push(textNode("\n", parent));
				}
				for (const node of replacement) {
					node.parentNode = parent;
				}
				children.splice(index, 1, ...replacement);
				index -= 1;
				unwrapped = true;
				continue;
			}
			stack.push([child, depth + 1]);
		}
		if (unwrapped) {
			coalesceText(parent);
		}
	}
};

/** The start of a script or style element, or of a comment (whose content is not markup). */
const SCRIPT_OR_STYLE_START = /<!--|<(script|style)(?=[\s/>])/gi;

/** Where a script or style body ends: its closing tag, as the HTML tokenizer recognises it. */
const CLOSING_TAG: Record<string, RegExp> = {
	script: /<\/script[\s/>]/gi,
	style: /<\/style[\s/>]/gi,
};

/**
 * The index just past a start tag's `>`, or -1 when the document ends first. Attribute values
 * may contain `>` (MediaWiki's `data-mw` JSON does), so a quoted value after `=` is skipped whole.
 */
const startTagEnd = (html: string, from: number): number => {
	let index = from;
	while (index < html.length) {
		const char = html[index];
		if (char === ">") {
			return index + 1;
		}
		if (char === "=") {
			let value = index + 1;
			while (value < html.length && /\s/.test(html[value] ?? "")) {
				value++;
			}
			const quote = html[value];
			if (quote === '"' || quote === "'") {
				const close = html.indexOf(quote, value + 1);
				if (close < 0) {
					return -1;
				}
				index = close + 1;
				continue;
			}
			index = value;
			continue;
		}
		index++;
	}
	return -1;
};

/** Script bodies something downstream reads: the YouTube adapter's player response, and bot-challenge fingerprints. */
const isReadScript = (attributes: string, element: string): boolean =>
	/application\/ld\+json/i.test(attributes) ||
	element.includes(PLAYER_RESPONSE_VARIABLE) ||
	CHALLENGE_PATTERN.test(element);

/** Documents larger than this have their script and style bodies emptied before parsing. */
export const LARGE_DOCUMENT_CHARS = 2_000_000;

/**
 * Empties the script and style bodies conversion never reads, keeping the elements and their
 * attributes.
 *
 * Kept whole: JSON-LD (page metadata), YouTube's player response (its site adapter) and
 * bot-challenge scripts (`detectClientShell`'s fingerprints). Extraction skips script and style
 * content, so the converted Markdown is the same with or without this; what changes is the size
 * of the HTML — a bundled application ships megabytes of inline script. Use it before sending
 * HTML across a process boundary or holding it under a size cap.
 *
 * `parseHtml` applies it to documents past {@link LARGE_DOCUMENT_CHARS} as a memory safety
 * valve: an 11 MB documentation page with 5 MB of inline script exhausted a 128 MB heap during
 * parsing alone. A body ends where the HTML tokenizer ends it, at the first `</script` or
 * `</style` followed by whitespace, `/` or `>`.
 */
export const stripScriptBodies = (html: string): string => {
	// One forward pass: every search starts where the previous one ended, so hostile input
	// (thousands of unclosed tags or quotes) costs O(n), not O(n²).
	const out: string[] = [];
	let copied = 0;
	const start = new RegExp(SCRIPT_OR_STYLE_START);
	for (let match = start.exec(html); match; match = start.exec(html)) {
		if (match[1] === undefined) {
			// A `<script>` inside a comment is text; skip to the comment's end.
			const commentEnd = html.indexOf("-->", match.index + 4);
			if (commentEnd < 0) {
				break;
			}
			start.lastIndex = commentEnd + 3;
			continue;
		}
		const tag = match[1].toLowerCase();
		const bodyStart = startTagEnd(html, match.index + match[0].length);
		if (bodyStart < 0) {
			break;
		}
		const closing = CLOSING_TAG[tag] as RegExp;
		closing.lastIndex = bodyStart;
		const close = closing.exec(html);
		if (!close) {
			// The tokenizer reads everything after an unclosed script or style as its body.
			break;
		}
		const tagEnd = html.indexOf(">", close.index);
		const elementEnd = tagEnd < 0 ? html.length : tagEnd + 1;
		const element = html.slice(match.index, elementEnd);
		const openingTag = html.slice(match.index, bodyStart);
		if (!(tag === "script" && isReadScript(openingTag, element))) {
			out.push(html.slice(copied, bodyStart), html.slice(close.index, elementEnd));
			copied = elementEnd;
		}
		start.lastIndex = elementEnd;
	}
	out.push(html.slice(copied));
	return out.join("");
};

/**
 * Parses HTML into HAST for conversion.
 *
 * Equivalent to `hast-util-from-html` except for what a Worker needs: no source positions (a
 * position object pair on every node roughly doubles the tree's memory, and nothing in the
 * conversion reads them), bounded nesting (see {@link MAX_ELEMENT_DEPTH}) and, for very large
 * documents, empty script and style bodies (see {@link stripScriptBodies}).
 */
export const parseHtml = (html: string, options: { fragment?: boolean } = {}): Root => {
	const source = html.length > LARGE_DOCUMENT_CHARS ? stripScriptBodies(html) : html;
	const document = options.fragment
		? parseFragment(source, { scriptingEnabled: false })
		: parse(source, { scriptingEnabled: false });
	flattenDeep(document, MAX_ELEMENT_DEPTH);
	return fromParse5(document) as Root;
};
