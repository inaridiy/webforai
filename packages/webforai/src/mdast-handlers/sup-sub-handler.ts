import type { Handle } from "hast-util-to-mdast";
import { toString as hastToString } from "hast-util-to-string";
import type { Html } from "mdast";

/**
 * Longer than this and the content is prose that happens to be styled, not an annotation.
 * Wrapping a whole sentence in `<sup>` would only add noise.
 */
const MAX_ANNOTATION_LENGTH = 32;

/**
 * Keeps superscripts and subscripts distinguishable.
 *
 * Markdown has no syntax for either, so the default conversion flattens them into the
 * surrounding text: `x<sup>2</sup>` becomes `x2`, `H<sub>2</sub>O` becomes `H2O`, and Wikipedia's
 * citation markers merge into the sentence that references them. Emitting inline HTML is valid
 * Markdown and preserves the distinction for readers and models alike.
 */
export const supSubHandler =
	(tagName: "sup" | "sub"): Handle =>
	(state, node) => {
		const inner = hastToString(node).trim();

		if (inner.length === 0 || inner.length > MAX_ANNOTATION_LENGTH) {
			// Fall back to plain inline content rather than emitting an unhelpful HTML blob.
			return state.all(node);
		}

		const escaped = inner.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		const result: Html = { type: "html", value: `<${tagName}>${escaped}</${tagName}>` };
		state.patch(node, result);
		return result;
	};
