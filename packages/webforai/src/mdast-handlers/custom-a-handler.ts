import { type Handle, defaultHandlers } from "hast-util-to-mdast";
import { toString as hastToString } from "hast-util-to-string";

export const customAHandler =
	(options?: { asText?: boolean }): Handle =>
	(state, node) => {
		if (options?.asText) {
			const text = hastToString(node);
			if (3 >= text.length) {
				return undefined;
			}

			const link = { type: "text", value: text } as const;
			state.patch(node, link);
			return link;
		}

		const link = defaultHandlers.a(state, node);
		if (link.children.length > 0) {
			return link;
		}
		return undefined;
	};
