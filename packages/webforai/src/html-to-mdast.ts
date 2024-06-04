import type { Nodes as Hast } from "hast";
import type { Nodes as Mdast } from "mdast";

import { fromHtml } from "hast-util-from-html";
import { toMdast } from "hast-util-to-mdast";

import { type Extracotrs, extractHast } from "./extract-hast";
import { customAHandler } from "./mdast-handlers/custom-a-handler";
import { customCodeHandler } from "./mdast-handlers/custom-code-handler";
import { customDivHandler } from "./mdast-handlers/custom-div-handler";
import { customImgHandler } from "./mdast-handlers/custom-img-handler";
import { customTableHandler } from "./mdast-handlers/custom-table-handler";
import { emptyHandler } from "./mdast-handlers/empty-handler";
import { mathHandler } from "./mdast-handlers/math-handler";

export type HtmlToMdastOptions = {
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
 * Converts an HTML string or HAST tree to an MDAST tree.
 *
 * @param htmlOrHast - The HTML string or HAST tree to convert.
 * @param options - {@link HtmlToMdastOptions} to customize the conversion.
 * @returns The MDAST tree.
 *
 * @example
 * ```ts
 * import { htmlToMdast } from 'webforai';
 *
 * const html = '<h1>Hello, world!</h1>';
 * const mdast = htmlToMdast(html);
 *
 * console.log(mdast); // Output: { type: 'root', children: [ { type: 'heading', depth: 1, children: [ { type: 'text', value: 'Hello, world!' } ] } ] }
 * ```
 */
export const htmlToMdast = (htmlOrHast: string | Hast, options?: HtmlToMdastOptions): Mdast => {
	const { extractors } = options || {};

	const hast = typeof htmlOrHast === "string" ? fromHtml(htmlOrHast, { fragment: true }) : htmlOrHast;

	const extractedHast = extractHast(hast, extractors);

	const mdast = toMdast(extractedHast, {
		handlers: {
			math: mathHandler,
			div: customDivHandler,
			pre: customCodeHandler,
			a: customAHandler({ asText: options?.linkAsText }),
			img: customImgHandler({ hideImage: options?.hideImage }),
			table: customTableHandler({ asText: options?.tableAsText }),
			br: emptyHandler,
		},
	});

	return mdast;
};
