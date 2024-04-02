import { type Handle, defaultHandlers } from "hast-util-to-mdast";
import { toString } from "hast-util-to-string";

export const customAHandler =
	(options?: { asText?: boolean }): Handle =>
	(state, node) => {
		if (options?.asText) return { type: "text", value: toString(node) };
		const link = defaultHandlers.a(state, node);
		if (link.children.length > 0) return link;
		return undefined;
	};
