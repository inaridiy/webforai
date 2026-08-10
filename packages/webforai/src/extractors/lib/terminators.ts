/**
 * Trailing-boilerplate truncation.
 *
 * Articles end, pages do not: after the last paragraph come the feedback widget, the
 * last-modified line, the contribution plea and the related-article rail. Each block is
 * individually hard to condemn — "Thanks for the feedback…" is a well-formed prose paragraph
 * with commas and links — but the first of them reliably marks the end of the content, and
 * everything after it belongs to the page. boilerpipe called these terminating blocks.
 *
 * The rule is position-guarded: a marker only terminates when it appears in the tail of the
 * document, so an article *about* feedback widgets is never cut at its own subject matter.
 */

import type { Element, Nodes as Hast, Parent } from "hast";

import { isElement, isParent, pruneInPlace } from "../../utils/hast-fast";

/**
 * Block texts that mark the end of the article.
 *
 * Anchored prefixes, matched against a whole block's text. Kept deliberately specific: every
 * entry is page furniture wording, not something an author writes mid-article.
 */
const TERMINATOR_PATTERNS: RegExp[] = [
	/^was this (page|article|document) helpful/i,
	/^thanks for the feedback/i,
	/^(this page was )?last (modified|updated) (on|at|:)?\s/i,
	/^learn how to contribute/i,
	/^help (us )?improve\b/i,
	// The stranded Yes/No pair of a feedback widget whose question was removed separately.
	/^yes ?no$/i,
	/^(related (articles?|posts?|stories|content)|you might also like|recommended for you|more from|read next)$/i,
	/^(comments?|leave a (comment|reply)|join the (conversation|discussion))$/i,
	/^(この(ページ|記事)は(参考|役に立ち)ました?か)/,
	/^(関連記事|あわせて読みたい|こちらもおすすめ|おすすめ記事)$/,
	/^(コメントを(残す|書く)|コメント一覧)$/,
	/^最終更新日?[:：\s]/,
];

/** A terminator only counts once this fraction of the document's text has passed. */
const TAIL_START_FRACTION = 0.8;

/** Longer than this and a block is an article section, whatever it opens with. */
const MAX_TERMINATOR_BLOCK_LENGTH = 500;

/** Block-level tags considered as potential terminators. */
const BLOCK_TAGS = new Set(["p", "div", "section", "footer", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol"]);

/** True when this block, at this position, marks the end of the article. */
const isTerminatorBlock = (element: Element, start: number, tailStart: number): boolean => {
	if (!BLOCK_TAGS.has(element.tagName) || start < tailStart) {
		return false;
	}
	const text = textOf(element).replace(/\s+/g, " ").trim();
	if (text.length === 0 || text.length > MAX_TERMINATOR_BLOCK_LENGTH) {
		return false;
	}
	return TERMINATOR_PATTERNS.some((pattern) => pattern.test(text));
};

const textOf = (node: Hast): string => {
	if (node.type === "text") {
		return node.value;
	}
	if (!isParent(node)) {
		return "";
	}
	let text = "";
	for (const child of node.children) {
		text += textOf(child as Hast);
	}
	return text;
};

/**
 * Removes the first tail-positioned terminating block and everything after it.
 *
 * Offsets are computed in one pass; the cut then removes every node whose text lies entirely at
 * or beyond the terminator, so containers that straddle the boundary keep their leading content
 * and lose the rest.
 *
 * @returns Whether anything was removed.
 */
export const truncateTrailingBoilerplate = (tree: Hast): boolean => {
	const starts = new Map<Hast, number>();
	let total = 0;

	const measure = (node: Hast): void => {
		starts.set(node, total);
		if (node.type === "text") {
			total += node.value.trim().length;
			return;
		}
		if (isParent(node)) {
			for (const child of node.children) {
				measure(child as Hast);
			}
		}
	};
	measure(tree);

	if (total === 0) {
		return false;
	}

	const tailStart = total * TAIL_START_FRACTION;
	let cutoff = -1;

	const find = (node: Hast): void => {
		if (cutoff !== -1 || !isParent(node)) {
			return;
		}
		for (const child of node.children) {
			if (cutoff !== -1) {
				return;
			}
			if (!isElement(child)) {
				continue;
			}

			const start = starts.get(child) ?? 0;
			if (isTerminatorBlock(child, start, tailStart)) {
				cutoff = start;
				return;
			}

			find(child);
		}
	};
	find(tree);

	if (cutoff === -1) {
		return false;
	}

	// The root always survives; children at or past the cut are removed level by level.
	pruneInPlace(tree, (node) => {
		if (node === tree) {
			return true;
		}
		const start = starts.get(node);
		if (start === undefined) {
			return true;
		}
		// A node straddling the boundary is kept; its own offending children fail this same test.
		if (start >= cutoff) {
			return false;
		}
		return true;
	});

	return true;
};

/** Exported for tests. */
export const TERMINATOR_TAIL_FRACTION = TAIL_START_FRACTION;

export type { Parent };
