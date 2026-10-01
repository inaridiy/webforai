/**
 * What the heuristic extractor keeps, as evidence for the learned model.
 *
 * The two extractors fail differently — the heuristic picks one container precisely but loses
 * content outside it; the block model recovers that content but sometimes keeps a whole page —
 * and an ensemble of extractors beats each alone (Bevendorff et al., SIGIR 2023). The heuristic
 * runs on a copy of the tree; elements are tagged with an index first, so the survivors in the
 * copy map back to the original elements.
 */

import type { Element, Nodes as Hast } from "hast";

import { isElement, walk } from "../../utils/hast-fast";
import { takumiExtractor } from "../presets/takumi";

const MARK = "dataWebforaiIndex";

/**
 * Copies the element structure, sharing text and comment nodes.
 *
 * Extraction replaces text nodes but never edits one in place, so sharing them is safe, and it
 * keeps the copy small: a page that is mostly text no longer doubles in memory. Iterative, so no
 * nesting depth can exhaust the stack.
 */
const cloneElements = <T extends Hast>(root: T): T => {
	const copyOf = (node: Hast): Hast =>
		"children" in node
			? ({
					...node,
					...(isElement(node) ? { properties: { ...node.properties } } : {}),
					children: [...node.children],
				} as Hast)
			: node;
	const copy = copyOf(root);
	const stack: Hast[] = [copy];
	while (stack.length > 0) {
		const parent = stack.pop() as Hast;
		if (!("children" in parent)) {
			continue;
		}
		const children = parent.children as Hast[];
		for (let index = 0; index < children.length; index++) {
			if ("children" in children[index]) {
				children[index] = copyOf(children[index]);
				stack.push(children[index]);
			}
		}
	}
	return copy as T;
};

/** Elements of `root` that survive heuristic extraction. `root` is left unchanged. */
export const takumiSelection = (root: Hast, lang?: string, url?: string): Set<Element> => {
	const elements: Element[] = [];
	walk(root, (node) => {
		if (isElement(node)) {
			node.properties[MARK] = elements.length;
			elements.push(node);
		}
	});
	const copy = cloneElements(root);
	for (const element of elements) {
		delete element.properties[MARK];
	}

	const kept = new Set<Element>();
	walk(takumiExtractor({ hast: copy, lang, url, owned: true }), (node) => {
		if (isElement(node)) {
			const index = node.properties[MARK];
			if (typeof index === "number" && elements[index]) {
				kept.add(elements[index]);
			}
		}
	});
	return kept;
};
