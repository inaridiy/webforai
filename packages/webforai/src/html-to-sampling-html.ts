import type { Nodes as Hast } from "hast";
import { fromHtml } from "hast-util-from-html";

import { toHtml } from "hast-util-to-html";
import { type Extracotrs, extractHast } from "./extract-hast";

export type HtmlToSamplingHtmlOptions = {
	/**
	 * An array of extractors to extract specific elements from the HTML.
	 * You can define your own functions in addition to the Extractor provided as a preset.
	 */
	extractors?: Extracotrs;
	/** Whether to convert links to plain text. */
	linkAsText?: boolean;
	/** Whether to convert tables to plain text. */
	tableAsText?: boolean;
	/** Whether to hide images. */
	hideImage?: boolean;
};

/**
 * Converts an HTML string or HAST tree to a sampling HTML.
 *
 * @param htmlOrHast - The HTML string or HAST tree to convert.
 * @param options - {@link HtmlToSamplingHtmlOptions} to customize the conversion.
 * @returns The sampling HTML.
 *
 * @example
 * ```ts
 * import { htmlToMdast } from 'webforai';
 *
 * const html = '<h1>Hello, world!</h1>';
 * const samplingHtml = htmlToSamplingHtml(html);
 *
 * console.log(samplingHtml); // Output: '<h1>Hello, world!</h1>'
 * ```
 */
export const htmlToSamplingHtml = (htmlOrHast: string | Hast, options?: HtmlToSamplingHtmlOptions): string => {
	const { extractors } = options || {};

	const hast = typeof htmlOrHast === "string" ? fromHtml(htmlOrHast, { fragment: true }) : htmlOrHast;

	const extractedHast = extractHast(hast, extractors);

	return toHtml(extractedHast);
};
