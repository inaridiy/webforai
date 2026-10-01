/**
 * Text-block segmentation.
 *
 * A block is a maximal run of inline content directly inside one block-level element — the unit
 * boilerplate-detection work since Kohlschütter et al. (WSDM 2010) classifies. `<div>Intro <b>x</b>
 * <p>Para</p> tail</div>` yields three blocks: "Intro x" and "tail" owned by the `div`, "Para" owned
 * by the `p`. Preformatted text and table cells are atomic. Segmentation is a single traversal.
 */

import type { Element, Nodes as Hast } from "hast";

import { classList, isElement, stringProperty } from "../../utils/hast-fast";

/** Elements that start a new block. Everything else is inline and joins the current run. */
export const BLOCK_TAGS = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"body",
	"caption",
	"center",
	"dd",
	"details",
	"dialog",
	"div",
	"dl",
	"dt",
	"fieldset",
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
	"hgroup",
	"hr",
	"html",
	"li",
	"main",
	"menu",
	"nav",
	"ol",
	"p",
	"pre",
	"section",
	"summary",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
	"ul",
]);

/** Never rendered as text. */
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "math", "head", "title", "iframe"]);

/**
 * A block-level element on the path from the root to a block.
 *
 * Frames form a linked list shared by every block below the same element, so a deeply nested
 * page costs one frame per element rather than one ancestor array per block — the difference
 * between kilobytes and the whole of a Worker's memory on adversarial input.
 */
export interface BlockFrame {
	element: Element;
	parent: BlockFrame | undefined;
	/** Number of block-level elements from the root to this one, inclusive. */
	depth: number;
}

export interface TextBlock {
	/** Document-order index. */
	index: number;
	/** The block-level element whose inline content this is. */
	owner: Element;
	/** The owner's frame; walk `parent` for its block-level ancestors. */
	frame: BlockFrame;
	/** Whitespace-collapsed text. */
	text: string;
	/** Characters of `text` inside links. */
	linkChars: number;
	/** Number of `<a href>` elements contributing. */
	links: number;
	/** Number of images. */
	images: number;
}

const collapse = (value: string): string => value.replace(/\s+/g, " ");

/**
 * Splits a tree into text blocks, in document order.
 *
 * @param root - Any HAST node; usually the `<body>` after invisible content is removed.
 * @param maxBlocks - Stop after this many blocks, bounding work on pathological pages.
 */
export const segmentBlocks = (root: Hast, maxBlocks = 20000): TextBlock[] => {
	const blocks: TextBlock[] = [];
	let frame: BlockFrame | undefined;
	const enter = (element: Element) => {
		frame = { element, parent: frame, depth: (frame?.depth ?? 0) + 1 };
	};
	const leave = () => {
		frame = frame?.parent;
	};

	let text = "";
	let linkChars = 0;
	let links = 0;
	let images = 0;

	const flush = () => {
		const trimmed = text.trim();
		if (frame && (trimmed.length > 0 || images > 0) && blocks.length < maxBlocks) {
			blocks.push({
				index: blocks.length,
				owner: frame.element,
				frame,
				text: trimmed,
				linkChars: Math.min(linkChars, trimmed.length),
				links,
				images,
			});
		}
		text = "";
		linkChars = 0;
		links = 0;
		images = 0;
	};

	const visitInline = (node: Hast, inLink: boolean): void => {
		if (node.type === "text") {
			const value = collapse(node.value);
			text += value;
			if (inLink) {
				linkChars += value.trim().length;
			}
			return;
		}
		if (!isElement(node)) {
			return;
		}
		visit(node, inLink);
	};

	const visit = (element: Element, inLink: boolean): void => {
		const tag = element.tagName;
		if (SKIP_TAGS.has(tag)) {
			return;
		}
		if (tag === "br") {
			text += " ";
			return;
		}
		if (tag === "img") {
			images += 1;
			return;
		}

		if (tag === "pre") {
			flush();
			enter(element);
			text = preformatted(element);
			flush();
			leave();
			return;
		}

		if (BLOCK_TAGS.has(tag)) {
			flush();
			enter(element);
			for (const child of element.children) {
				visitInline(child as Hast, inLink);
			}
			flush();
			leave();
			return;
		}

		const isLink = tag === "a" && stringProperty(element, "href") !== undefined;
		if (isLink) {
			links += 1;
		}
		for (const child of element.children) {
			visitInline(child as Hast, inLink || isLink);
		}
	};

	if (isElement(root)) {
		visit(root, false);
	} else if ("children" in root) {
		for (const child of root.children) {
			visitInline(child as Hast, false);
		}
		flush();
	}

	return blocks;
};

const preformatted = (element: Element): string => {
	let value = "";
	const walk = (node: Hast): void => {
		if (node.type === "text") {
			value += node.value;
		} else if (isElement(node) && !SKIP_TAGS.has(node.tagName)) {
			for (const child of node.children) {
				walk(child as Hast);
			}
		}
	};
	walk(element);
	return value;
};

/** The owner (`up = 0`) or its `up`-th block-level ancestor. */
export const ancestorAt = (block: TextBlock, up: number): Element | undefined => {
	let current: BlockFrame | undefined = block.frame;
	for (let step = 0; step < up && current; step++) {
		current = current.parent;
	}
	return current?.element;
};

/** Block-level ancestors, outermost first, ending with the owner. Allocates; for tooling. */
export const ancestorsOf = (block: TextBlock): Element[] => {
	const elements: Element[] = [];
	for (let current: BlockFrame | undefined = block.frame; current; current = current.parent) {
		elements.push(current.element);
	}
	return elements.reverse();
};

/** A compact `tag.class#id` description of an element, for diagnostics. */
export const describeElement = (element: Element, maxClasses = 2): string => {
	const id = stringProperty(element, "id");
	const classes = classList(element)
		.filter((name) => name.length <= 32)
		.slice(0, maxClasses);
	return `${element.tagName}${id && id.length <= 32 ? `#${id}` : ""}${classes.map((name) => `.${name}`).join("")}`;
};
