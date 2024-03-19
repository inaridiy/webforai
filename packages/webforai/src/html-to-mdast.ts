import type { Nodes as Hast } from "hast";
import type { Nodes as Mdast } from "mdast";

import { fromHtml } from "hast-util-from-html";
import { toMdast } from "hast-util-to-mdast";

import { stronglyExtractHast } from "./extract-hast";
import { customAHandler } from "./mdast-handlers/custom-a-handler";
import { customDivHandler } from "./mdast-handlers/custom-div-handler";
import { mathHandler } from "./mdast-handlers/math-handler";

type ExtractHast = ((hast: Hast) => Hast) | false | "strongly";

const PRESET_EXTRACT_HAST = {
	strongly: stronglyExtractHast,
};

const DEFAULT_EXTRACT_HAST: ExtractHast[] = ["strongly"];

export type HtmlToMdastOptions = {
	extractHast?: ExtractHast | ExtractHast[];
};

export const htmlToMdast = (html: string, options?: HtmlToMdastOptions): Mdast => {
	const { extractHast = DEFAULT_EXTRACT_HAST } = options || {};
	const _extractHast = Array.isArray(extractHast) ? extractHast : [extractHast];

	const hast = fromHtml(html, { fragment: true });
	const extractedHast =
		_extractHast.reduce<Hast>((acc, extractHast) => {
			if (extractHast === false) return acc;
			if (typeof extractHast === "string" && extractHast in PRESET_EXTRACT_HAST)
				return PRESET_EXTRACT_HAST[extractHast](acc);
			if (typeof extractHast === "function") return extractHast(acc);
			throw new Error(`Invalid extractHast: ${extractHast}`);
		}, hast) || hast;

	const mdast = toMdast(extractedHast, {
		handlers: { div: customDivHandler, math: mathHandler, a: customAHandler, br: () => {} },
	});

	return mdast;
};
