import type { Root } from "hast";
import { fromParse5 } from "hast-util-from-parse5";
import { type DefaultTreeAdapterMap, parse, parseFragment } from "parse5";

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
type Parse5Element = DefaultTreeAdapterMap["element"];

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
const BUTTON_TYPES = new Set(["submit", "reset", "button", "menu"]);

/**
 * Repairs attributes that make `hast-util-from-parse5` lose the element.
 *
 * It builds elements with `hastscript`, which reads a properties object that has a string `type`
 * as a child *node* in two cases: a `<button>` whose `type` is not a button type
 * (`<button type="text">`), and any element but `<input>` that also has a `value`. The element's
 * attributes then become a "text" node without a value, and conversion throws on it. An invalid
 * button type means `submit` in HTML anyway; elsewhere `type` is dropped when `value` is present.
 */
const repairNodeLikeAttributes = (element: Parse5Element): void => {
	const type = element.attrs.find((attribute) => attribute.name === "type");
	if (!type || element.tagName === "input") {
		return;
	}
	if (element.tagName === "button") {
		if (!BUTTON_TYPES.has(type.value.toLowerCase())) {
			type.value = "submit";
		}
		return;
	}
	if (element.attrs.some((attribute) => attribute.name === "value")) {
		element.attrs = element.attrs.filter((attribute) => attribute !== type);
	}
};

/** Applies {@link repairNodeLikeAttributes} to every element, iteratively. */
const repairAttributes = (root: Parse5Parent): void => {
	const stack: Parse5Parent[] = [root];
	while (stack.length > 0) {
		const parent = stack.pop() as Parse5Parent;
		for (const child of parent.childNodes) {
			if ("attrs" in child) {
				repairNodeLikeAttributes(child);
			}
			if (isParent(child)) {
				stack.push(child);
			}
		}
	}
};

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

/** A script or style element with its body; JSON-LD scripts are matched separately below. */
const SCRIPT_OR_STYLE = /<(script|style)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi;

/** Documents larger than this have their script and style bodies emptied before parsing. */
export const LARGE_DOCUMENT_CHARS = 2_000_000;

/**
 * Empties script and style bodies before parsing, except JSON-LD, which metadata reads.
 *
 * A bundled application ships megabytes of inline script: an 11 MB documentation page with 5 MB
 * of it exhausted a 128 MB heap during parsing alone. Site adapters read some scripts (YouTube's
 * player response, MediaWiki's page configuration), so this only runs on documents past
 * {@link LARGE_DOCUMENT_CHARS}, as a memory safety valve. The parser ends a script at the first
 * `</script`, which is what the pattern matches too.
 */
export const stripScriptBodies = (html: string): string =>
	html.replace(SCRIPT_OR_STYLE, (match, tag: string, attributes: string) =>
		/application\/ld\+json/i.test(attributes) ? match : `<${tag}${attributes}></${tag}>`,
	);

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
	repairAttributes(document);
	flattenDeep(document, MAX_ELEMENT_DEPTH);
	return fromParse5(document) as Root;
};
