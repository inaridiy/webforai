import type { Element } from "hast";
import { type Handle, defaultHandlers } from "hast-util-to-mdast";
import type { Image } from "mdast";

import { stringProperty } from "../utils/hast-fast";

/**
 * Longest `data:` URL kept as an image source.
 *
 * An embedded blob is unusable as a Markdown link — nothing can fetch it once the page is gone —
 * and a full-size base64 photo costs thousands of tokens for no information. Short ones are kept
 * because inline icons occasionally carry meaning. Anything larger is dropped along with the
 * image, since normalisation has already tried every real source attribute by this point.
 */
const MAX_DATA_URL_LENGTH = 256;

/** True when an image has no source a reader could resolve. */
const hasNoUsableSource = (node: Element): boolean => {
	const src = stringProperty(node, "src")?.trim();
	if (!src) {
		return true;
	}
	if (src.startsWith("data:")) {
		return src.length > MAX_DATA_URL_LENGTH;
	}
	return false;
};

/**
 * File names of the stand-in a lazy loader shows until the real image arrives.
 *
 * BBC renders `grey-placeholder.png` beside every real photo; the pair otherwise yields an
 * extra, meaningless image per teaser. Matched on the last path segment only, and only for
 * images that describe nothing, so a photo that merely lives under a `/placeholder/` path or an
 * image with real alt text is kept.
 */
const PLACEHOLDER_FILE =
	/^(?:[\w-]*[-_.])?placeholder[\w-]*\.(?:gif|png|svg|webp|jpe?g)$|^(?:spacer|blank|transparent|pixel)\.(?:gif|png)$/i;

const isUndescribedPlaceholder = (node: Element): boolean => {
	if (stringProperty(node, "alt")?.trim() || stringProperty(node, "title")?.trim()) {
		return false;
	}
	const src = stringProperty(node, "src") ?? "";
	const file = src.split(/[?#]/)[0].split("/").pop() ?? "";
	return PLACEHOLDER_FILE.test(file);
};

export const customImgHandler =
	(options?: { hideImage?: boolean }): Handle =>
	(state, node) => {
		if (options?.hideImage) {
			return undefined;
		}
		if (hasNoUsableSource(node) || isUndescribedPlaceholder(node)) {
			return undefined;
		}

		const image = defaultHandlers.image(state, node) as Image;

		// `title` is the other place authors describe an image; without this the description is
		// lost whenever `alt` is empty, which is common on figure-based layouts.
		if (!image.alt) {
			const title = stringProperty(node, "title");
			if (title) {
				image.alt = title;
			}
		}

		return image;
	};
