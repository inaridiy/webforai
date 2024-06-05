import type { Nodes as Mdast, Parent } from "mdast";
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

export const extractMdast = (node: Mdast) => {
	const extracted = filter(node, (node) => {
		if (!emptyDeclarationFilter(node as Mdast)) {
			return false;
		}
		return true;
	});
	return extracted as Mdast;
};
