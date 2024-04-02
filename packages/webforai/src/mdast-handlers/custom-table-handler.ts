import { type Handle, defaultHandlers } from "hast-util-to-mdast";
import { toText } from "hast-util-to-text";

export const customTableHandler =
	(options?: { asText?: boolean }): Handle =>
	(state, node) => {
		if (options?.asText) return { type: "paragraph", children: [{ type: "text", value: toText(node) }] };
		return defaultHandlers.table(state, node);
	};
