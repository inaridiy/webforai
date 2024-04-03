import { type Handle, defaultHandlers } from "hast-util-to-mdast";
import { toString } from "hast-util-to-string";

export const customAHandler =
	(options?: { asText?: boolean }): Handle =>
	(state, node) => {
		if (options?.asText) {
			const link = { type: "text", value: toString(node) } as const;
			state.patch(node, link);
			return link;
		}

		const link = defaultHandlers.a(state, node);
		if (link.children.length > 0) return link;
		return undefined;
	};
