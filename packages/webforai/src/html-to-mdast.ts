import type { Nodes as Hast } from "hast";
import type { Nodes as Mdast } from "mdast";

import { fromHtml } from "hast-util-from-html";
import { toMdast } from "hast-util-to-mdast";

import { stronglyExtractHast } from "./extract-hast";
import { readabilityExtractHast } from "./extract-hast/readability";
import { customAHandler } from "./mdast-handlers/custom-a-handler";
import { customDivHandler } from "./mdast-handlers/custom-div-handler";
import { customImgHandler } from "./mdast-handlers/custom-img-handler";
import { customTableHandler } from "./mdast-handlers/custom-table-handler";
import { mathHandler } from "./mdast-handlers/math-handler";

type ExtractHast = ((hast: Hast) => Hast) | false | "strongly" | "readability";

const PRESET_EXTRACT_HAST = {
	strongly: stronglyExtractHast,
	readability: readabilityExtractHast,
};

const DEFAULT_EXTRACT_HAST: ExtractHast[] = ["readability"];

export type HtmlToMdastOptions = {
	extractHast?: ExtractHast | ExtractHast[];
	linkAsText?: boolean;
	tableAsText?: boolean;
	hideImage?: boolean;
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
		handlers: {
			math: mathHandler,
			div: customDivHandler,
			a: customAHandler({ asText: options?.linkAsText }),
			img: customImgHandler({ hideImage: options?.hideImage }),
			table: customTableHandler({ asText: options?.tableAsText }),
			br: () => {},
		},
	});

	return mdast;
};
