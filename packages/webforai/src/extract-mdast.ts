import type { Nodes as Mdast, Paragraph, Parent, PhrasingContent, RootContent } from "mdast";
import { filter } from "unist-util-filter";

const DECLATION_TYPES = ["blockquote", "strong", "emphasis", "delete"];

const emptyDeclarationFilter = (node: Mdast) => {
	if (!DECLATION_TYPES.includes(node.type)) {
		return true;
	}
	if ((node as Parent).children.length === 0) {
		return false;
	}

	return true;
};

const trimEdge = (children: PhrasingContent[], edge: "start" | "end"): PhrasingContent[] => {
	const index = edge === "start" ? 0 : children.length - 1;
	const node = children[index];
	if (node?.type !== "text") {
		return children;
	}
	const value = edge === "start" ? node.value.trimStart() : node.value.trimEnd();
	const copy = [...children];
	if (value.length === 0) {
		copy.splice(index, 1);
	} else {
		copy[index] = { ...node, value };
	}
	return copy;
};

/**
 * Splits a paragraph around the display formulas it contains.
 *
 * MediaWiki writes block formulas inline in the sentence that introduces them ("the equality
 * <math display="block">…</math> where"). A block `math` node inside a paragraph serialises as
 * `$$` glued to the surrounding words, which no Markdown renderer reads as a formula. The browser
 * puts the formula on its own line, and so does this.
 */
const liftDisplayMath = (paragraph: Paragraph): RootContent[] | undefined => {
	if (!paragraph.children.some((child) => (child as Mdast).type === "math")) {
		return undefined;
	}

	const out: RootContent[] = [];
	let run: PhrasingContent[] = [];
	const flush = () => {
		const trimmed = trimEdge(trimEdge(run, "start"), "end");
		if (trimmed.length > 0) {
			out.push({ ...paragraph, children: trimmed });
		}
		run = [];
	};

	for (const child of paragraph.children) {
		if ((child as Mdast).type === "math") {
			flush();
			out.push(child as unknown as RootContent);
		} else {
			run.push(child);
		}
	}
	flush();
	return out;
};

const liftDisplayMathIn = (node: Mdast): void => {
	if (!("children" in node)) {
		return;
	}
	const parent = node as Parent;
	for (let index = 0; index < parent.children.length; index++) {
		const child = parent.children[index] as Mdast;
		const lifted = child.type === "paragraph" ? liftDisplayMath(child) : undefined;
		if (lifted) {
			parent.children.splice(index, 1, ...(lifted as Parent["children"]));
			index += lifted.length - 1;
			continue;
		}
		liftDisplayMathIn(child);
	}
};

export const extractMdast = (node: Mdast) => {
	const extracted = filter(node, (node) => {
		if (!emptyDeclarationFilter(node as Mdast)) {
			return false;
		}
		return true;
	});
	if (extracted) {
		liftDisplayMathIn(extracted as Mdast);
	}
	return extracted as Mdast;
};
