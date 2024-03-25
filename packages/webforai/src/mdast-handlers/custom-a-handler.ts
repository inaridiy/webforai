import { type Handle, defaultHandlers } from "hast-util-to-mdast";

export const customAHandler =
	(options?: { asText?: boolean }): Handle =>
	(state, node) => {
		if (options?.asText) {
			const link = defaultHandlers.a(state, node);
			if (link.children?.[0]?.type === "text") return link.children[0];
			return undefined;
		}

		const link = defaultHandlers.a(state, node);
		if (link.children.length > 0) return link;
		return undefined;
	};
