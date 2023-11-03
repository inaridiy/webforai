import type { Root as Hast } from "hast";
import type { Nodes as Mdast } from "mdast";

import { fromHtml } from "hast-util-from-html";
import { toMdast } from "hast-util-to-mdast";

import { extractHast } from "./extract-hast";
import { customDivHandler } from "./mdast-handlers/custom-div-handler";
import { mathHandler } from "./mdast-handlers/math-handler";

export type HtmlToMdastOptions = {
	extractHast?: false | ((hast: Hast) => Hast);
};

export const htmlToMdast = (html: string, options?: HtmlToMdastOptions): Mdast => {
	const hast = fromHtml(html, { fragment: true });
	const extractedHast = options?.extractHast ? options.extractHast(hast) : extractHast(hast);
	const mdast = toMdast(extractedHast, {
		handlers: { div: customDivHandler, math: mathHandler, br: () => {} },
	});

	return mdast;
};
