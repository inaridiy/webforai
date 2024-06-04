import { type Handle, defaultHandlers } from "hast-util-to-mdast";

export const customImgHandler =
	(options?: { hideImage?: boolean }): Handle =>
	(state, node) => {
		if (options?.hideImage) {
			return undefined;
		}
		return defaultHandlers.image(state, node);
	};
