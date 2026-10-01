import type { Nodes as Hast } from "hast";
import { fromHtml } from "hast-util-from-html";
import { toMdast } from "hast-util-to-mdast";
import type { Nodes as Mdast } from "mdast";

import { extractMdast } from "./extract-mdast";
import { type ExtractorSelectors, pipeExtractors } from "./extractors";
import { customAHandler } from "./mdast-handlers/custom-a-handler";
import { customCodeHandler } from "./mdast-handlers/custom-code-handler";
import { customDivHandler } from "./mdast-handlers/custom-div-handler";
import { customImgHandler } from "./mdast-handlers/custom-img-handler";
import { customTableHandler } from "./mdast-handlers/custom-table-handler";
import { definitionListHandler } from "./mdast-handlers/definition-list-handler";
import { mathHandler } from "./mdast-handlers/math-handler";
import { supSubHandler } from "./mdast-handlers/sup-sub-handler";
import { type NormalizeOptions, normalizeHast } from "./normalize";
import { cloneHast } from "./utils/hast-fast";
import { getLangFromHast, getLangFromStr, getUrlFromHast } from "./utils/hast-utils";

export type HtmlToMdastOptions = {
	/**
	 * An array of extractors to extract specific elements from the HTML.
	 * You can define your own functions in addition to the Extractor provided as a preset.
	 */
	extractors?: ExtractorSelectors;
	/** Whether to convert links to plain text. */
	linkAsText?: boolean;
	/** Whether to convert tables to plain text. */
	tableAsText?: boolean;
	/** Whether to hide images. */
	hideImage?: boolean;
	/** The language of the HTML. */
	lang?: string;
	/** The URL of the HTML. */
	url?: string;
	/** Markup repair passes applied before conversion. See {@link NormalizeOptions}. */
	normalize?: NormalizeOptions;
	/**
	 * Declares that the caller owns the HAST tree and extractors may mutate it in place.
	 *
	 * Set automatically when a string is passed. Supply it yourself only when you parsed the
	 * HTML and hold no other reference to the tree: it skips a full structural clone, which is
	 * the single most expensive step on large documents.
	 */
	owned?: boolean;
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
	const { extractors, url: defaultUrl, lang: defaultLang } = options || {};

	// A tree we parsed here is ours alone, so extractors may mutate it instead of cloning. A tree
	// handed in by the caller is read-only unless the caller says otherwise.
	const [lang, hast] =
		typeof htmlOrHast === "string"
			? [defaultLang || getLangFromStr(htmlOrHast), fromHtml(htmlOrHast, { fragment: true })]
			: [defaultLang || getLangFromHast(htmlOrHast), htmlOrHast];

	const isOwned = typeof htmlOrHast === "string" || (options?.owned ?? false);

	const url = defaultUrl || getUrlFromHast(hast);

	// Own the tree before extraction: disabled or custom extractors may return their input,
	// and normalization plus conversion handlers mutate it regardless of extractor choice.
	const extractedHast = pipeExtractors({ hast: isOwned ? hast : cloneHast(hast), lang, url, owned: true }, extractors);

	// Repairs markup the Markdown conversion cannot interpret (lazy image URLs, doubly-rendered
	// maths, ARIA-only headings). Runs after extraction so it only visits surviving nodes.
	normalizeHast(extractedHast, options?.normalize);

	const mdast = toMdast(extractedHast, {
		handlers: {
			math: mathHandler,
			div: customDivHandler,
			pre: customCodeHandler,
			dl: definitionListHandler,
			sup: supSubHandler("sup"),
			sub: supSubHandler("sub"),
			a: customAHandler({ asText: options?.linkAsText }),
			img: customImgHandler({ hideImage: options?.hideImage }),
			table: customTableHandler({ asText: options?.tableAsText }),
		},
	});

	const extractedMdast = extractMdast(mdast);

	return extractedMdast;
};
