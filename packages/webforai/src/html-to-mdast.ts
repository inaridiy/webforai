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
	extractHast?: Extracotrs;
	linkAsText?: boolean;
	tableAsText?: boolean;
	hideImage?: boolean;
};

export const htmlToMdast = (html: string, options?: HtmlToMdastOptions): Mdast => {
	const { extractHast: _extractHast } = options || {};

	const hast = fromHtml(html, { fragment: true });

	const extractedHast = extractHast(hast, _extractHast);

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
