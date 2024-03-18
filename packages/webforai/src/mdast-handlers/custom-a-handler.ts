import { type Handle, defaultHandlers } from "hast-util-to-mdast";

export const customAHandler: Handle = (state, node) => {
	const link = defaultHandlers.a(state, node);
	if (link.children.length > 0) return link;
	else return undefined;
};
