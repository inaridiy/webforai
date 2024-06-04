import { toHtml } from "hast-util-to-html";
import type { Handle } from "hast-util-to-mdast";
import { MathMLToLaTeX } from "mathml-to-latex";
import type { InlineMath, Math as mdMath } from "mdast-util-math";

export const mathHandler: Handle = (state, node) => {
	const mathMl = toHtml(node);
	const latex = MathMLToLaTeX.convert(mathMl);
	const result: InlineMath | mdMath = { type: "inlineMath", value: latex };
	state.patch(node, result);
	return result;
};
