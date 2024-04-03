import { type Handle, defaultHandlers } from "hast-util-to-mdast";
import { toText } from "hast-util-to-text";

export const customTableHandler =
	(options?: { asText?: boolean }): Handle =>
	(state, node) => {
		if (options?.asText) {
			const paragraph = { type: "paragraph" as const, children: [{ type: "text", value: toText(node) } as const] };
			state.patch(node, paragraph);
			return paragraph;
		}
		return defaultHandlers.table(state, node);
	};
