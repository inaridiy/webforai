import { type Handle, defaultHandlers } from "hast-util-to-mdast";

export const customBrHandler: Handle = (state, node) => {
	return defaultHandlers.br(state, node);
};
