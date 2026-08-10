import type { Element } from "hast";
import { toHtml } from "hast-util-to-html";
import type { Handle } from "hast-util-to-mdast";
import { MathMLToLaTeX } from "mathml-to-latex";
import type { InlineMath, Math as MdMath } from "mdast-util-math";

import { stringProperty } from "../utils/hast-fast";

/**
 * MathML's own annotation of the source the formula was written in.
 *
 * MediaWiki, and every other renderer that starts from LaTeX, records the original expression
 * here. Preferring it is not an optimisation: converting the rendered MathML back to LaTeX is
 * lossy, and the losses are silent and content-altering — Euler's identity came out as
 * `e^{i } + 1 = 0`, with π simply gone, and `i^2 = -1` lost its minus sign. The annotation is
 * exactly what the author wrote.
 */
const readAnnotation = (node: Element): string | undefined => {
	const alttext = stringProperty(node, "alttext");
	if (!alttext) {
		return undefined;
	}

	// Renderers wrap the expression in a display directive that is noise in Markdown.
	const unwrapped = alttext
		.trim()
		.replace(/^\{\\displaystyle\s*([\s\S]*)\}$/, "$1")
		.trim();
	return unwrapped.length > 0 ? unwrapped : undefined;
};

/** True when the formula was authored as a block rather than inline. */
const isDisplayMath = (node: Element): boolean => stringProperty(node, "display") === "block";

export const mathHandler: Handle = (state, node) => {
	const latex = readAnnotation(node) ?? MathMLToLaTeX.convert(toHtml(node));

	const result: InlineMath | MdMath = isDisplayMath(node)
		? { type: "math", value: latex, meta: null }
		: { type: "inlineMath", value: latex };

	state.patch(node, result);
	return result;
};
