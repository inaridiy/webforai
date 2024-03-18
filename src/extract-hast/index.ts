import type { Root as Hast } from "hast";
import { select, selectAll } from "hast-util-select";

import { remove } from "unist-util-remove";

export const extractHast = (hast: Hast) => {
	const removeSelectors = ["script", "noscript", "header", "footer", "nav", ".speechify-ignore"];

	for (const selector of removeSelectors) {
		const matchedNodes = selectAll(selector, hast);
		for (const node of matchedNodes) {
			remove(hast, node);
		}
	}

	const selectors = ["article", "div#article", "main", "div.container"];
	for (const selector of selectors) {
		const element = select(selector, hast);
		if (element) return element;
	}

	return hast;
};
