import type { Element } from "hast";
import { type Handle, defaultHandlers } from "hast-util-to-mdast";
import { toText } from "hast-util-to-text";

import { isElement, numericProperty, walk } from "../utils/hast-fast";

/**
 * Largest span honoured on a table cell.
 *
 * Grid reconciliation materialises one cell per spanned column and row, so a malformed
 * `colspan="999999"` — which real pages do emit, and which a hostile page could emit
 * deliberately — turns a small table into hundreds of millions of cells before anything is
 * written. No genuine table needs more than this.
 */
const MAX_SPAN = 1000;

/** Clamps `colspan`/`rowspan` in place so grid expansion stays bounded. */
const clampSpans = (node: Element): void => {
	walk(node, (candidate) => {
		if (!isElement(candidate) || (candidate.tagName !== "td" && candidate.tagName !== "th")) {
			return;
		}

		for (const attribute of ["colSpan", "rowSpan"]) {
			const span = numericProperty(candidate, attribute);
			if (span !== undefined && span > MAX_SPAN) {
				candidate.properties[attribute] = MAX_SPAN;
			}
		}
	});
};

export const customTableHandler =
	(options?: { asText?: boolean }): Handle =>
	(state, node) => {
		if (options?.asText) {
			const paragraph = { type: "paragraph" as const, children: [{ type: "text", value: toText(node) } as const] };
			state.patch(node, paragraph);
			return paragraph;
		}

		clampSpans(node);
		return defaultHandlers.table(state, node);
	};
