import type { Element, ElementContent, Nodes as Hast, Parent } from "hast";

/**
 * Elements that start and end a line when they appear inside preformatted text.
 *
 * `p` is absent on purpose: inside `<pre>` it is a line wrapper like any other, and the blank line
 * the browser puts between paragraphs is a margin, not a character of the code.
 */
const LINE_BLOCK_TAGS = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"dd",
	"div",
	"dl",
	"dt",
	"figcaption",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hr",
	"li",
	"main",
	"nav",
	"ol",
	"p",
	"pre",
	"section",
	"table",
	"tr",
	"ul",
]);

/**
 * Inline elements that a highlighter wraps tokens in.
 *
 * A block element nested inside one is styled inline: VitePress' Twoslash puts a hover card
 * `<div class="v-popper">` inside the token's `<span>`, and treating it as a block put every
 * annotated identifier on a line of its own. `code` is absent because CodeMirror nests its
 * per-line `div`s directly in it, and those *are* lines.
 */
const INLINE_CONTEXT_TAGS = new Set(["span", "a", "b", "i", "em", "strong", "mark", "small", "u", "s", "label"]);

/**
 * The text of a code block, line structure included.
 *
 * Line-per-element highlighters (CodeMirror's `div.cm-line`, Monaco, Sandpack) end each line with
 * a `<br>` *inside* the line's block. A browser draws no extra line for a `<br>` that closes a
 * block, but a generic `innerText` adds a block break after it, which put a blank line after every
 * line of code. Here a block boundary only ensures the text is at a line start, so the two cannot
 * double up. Block elements inside an inline token wrapper do not break lines at all. Table cells
 * are separated by a tab, as `innerText` does.
 */
export const preText = (node: Hast): string => {
	let out = "";

	const ensureLineStart = () => {
		if (out.length > 0 && out.charCodeAt(out.length - 1) !== 10) {
			out += "\n";
		}
	};

	const visitChildren = (parent: Parent, inline: boolean): void => {
		let cells = 0;
		for (const child of parent.children) {
			const isCell = child.type === "element" && (child.tagName === "td" || child.tagName === "th");
			visit(child, isCell ? cells++ : 0, inline);
		}
	};

	const visitElement = (element: Element, cellIndex: number, inline: boolean): void => {
		const tag = element.tagName;
		if (tag === "br") {
			out += "\n";
			return;
		}
		if (cellIndex > 0) {
			out += "\t";
		}

		const block = !inline && LINE_BLOCK_TAGS.has(tag);
		if (block) {
			ensureLineStart();
		}
		visitChildren(element, inline || INLINE_CONTEXT_TAGS.has(tag));
		if (block) {
			ensureLineStart();
		}
	};

	const visit = (current: Hast | ElementContent, cellIndex: number, inline: boolean): void => {
		if (current.type === "text") {
			out += current.value;
		} else if (current.type === "element") {
			visitElement(current, cellIndex, inline);
		} else if (current.type === "root") {
			visitChildren(current, inline);
		}
	};

	visit(node, 0, false);
	return out;
};
