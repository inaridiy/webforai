/**
 * Hacker News adapter.
 *
 * HN is laid out with nested tables and spacer images: comment depth is encoded as the `indent`
 * attribute on a `<td class="ind">` and as the pixel width of a transparent GIF. Generic
 * extraction sees one enormous table, scores it as a single block and returns either everything
 * or nothing, in both cases losing the reply structure that makes a thread readable.
 *
 * This adapter reconstructs the thread as nested blockquotes, which is the natural Markdown
 * representation of a reply chain.
 */

import type { Element, ElementContent, Nodes as Hast, RootContent } from "hast";
import { select, selectAll } from "hast-util-select";

import { numericProperty, stringProperty } from "../../utils/hast-fast";
import type { SiteAdapter } from "../types";

/** Deeper replies stop gaining a quote level: beyond this the output is unreadable. */
const MAX_QUOTE_DEPTH = 6;

const text = (value: string): ElementContent => ({ type: "text", value });

const element = (tagName: string, children: ElementContent[]): Element => ({
	type: "element",
	tagName,
	properties: {},
	children,
});

/** Comment indent, read from the `indent` attribute with the spacer width as a fallback. */
const commentDepth = (row: Element): number => {
	const cell = select("td.ind", row);
	if (!cell) {
		return 0;
	}

	const indent = numericProperty(cell, "indent");
	if (indent !== undefined) {
		return indent;
	}

	// Older markup only carries the spacer image, which is 40px per level.
	const spacer = select("img", cell);
	const width = spacer ? numericProperty(spacer, "width") : undefined;
	return width === undefined ? 0 : Math.round(width / 40);
};

/** Wraps `content` in `depth` levels of blockquote. */
const nest = (content: ElementContent[], depth: number): ElementContent => {
	let current: ElementContent[] = content;
	for (let level = 0; level < Math.min(depth, MAX_QUOTE_DEPTH); level++) {
		current = [element("blockquote", current)];
	}
	return current[0];
};

const storyNodes = (root: Hast): ElementContent[] => {
	const nodes: ElementContent[] = [];

	const titleLink = select(".titleline > a", root);
	if (titleLink) {
		nodes.push(element("h1", [...titleLink.children]));

		const href = stringProperty(titleLink, "href");
		if (href && /^https?:/.test(href)) {
			nodes.push(element("p", [{ ...titleLink, children: [text(href)] }]));
		}
	}

	// Ask HN and similar posts carry a body above the comments.
	const topText = select(".toptext", root);
	if (topText) {
		nodes.push(element("div", [...topText.children]));
	}

	return nodes;
};

const commentNodes = (root: Hast): ElementContent[] => {
	const nodes: ElementContent[] = [];

	for (const row of selectAll("tr.comtr, tr.athing.comtr", root)) {
		const body = select(".commtext", row);
		if (!body) {
			continue; // collapsed or flagged
		}

		const author = select(".hnuser", row);
		const header = author ? [element("strong", [...author.children])] : [];

		const content: ElementContent[] = [
			...(header.length > 0 ? [element("p", header)] : []),
			element("div", [...body.children]),
		];

		nodes.push(nest(content, commentDepth(row)));
	}

	return nodes;
};

export const hackernewsAdapter: SiteAdapter = {
	id: "hackernews",

	matches: ({ url }) => {
		if (!url) {
			return false;
		}
		try {
			return /(^|\.)ycombinator\.com$/.test(new URL(url).hostname);
		} catch {
			return false;
		}
	},

	matchesFingerprint: ({ signature }) => Boolean(signature?.ids.has("hnmain") || signature?.classes.has("fatitem")),

	extract: ({ hast }) => {
		const story = storyNodes(hast);
		const comments = commentNodes(hast);

		if (story.length === 0 && comments.length === 0) {
			return undefined;
		}

		const children: RootContent[] = [...story];
		if (comments.length > 0) {
			children.push(element("h2", [text("Comments")]));
			children.push(...comments);
		}

		return { type: "root", children } satisfies Hast;
	},
};
