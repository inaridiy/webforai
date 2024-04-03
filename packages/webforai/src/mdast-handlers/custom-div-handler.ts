import { select } from "hast-util-select";
import { type Handle, defaultHandlers } from "hast-util-to-mdast";
import { toString } from "hast-util-to-string";
import { toText } from "hast-util-to-text";
import type { Code } from "mdast";
import { trimTrailingLines } from "trim-trailing-lines";
import { detectLanguage } from "../utils/detect-code-lang";

const CODE_BLOCK_REGEX = /highlight-source|language-|codegroup|codeblock|code-block/i;

const CODE_FILENAME_SELECTORS = "[class*='fileName'],[class*='fileName'],[class*='title'],[class*='Title']";

export const customDivHandler: Handle = (state, node) => {
	const randomAnchor = Math.random().toString(36).substring(7);
	node.properties["data-anchor"] = randomAnchor;
	const classNames = Array.isArray(node.properties.className) ? (node.properties.className as string[]) : [];
	const codeBlock = select(
		`[data-anchor="${randomAnchor}"] > pre, [data-anchor="${randomAnchor}"] > * > pre, [data-anchor="${randomAnchor}"] > * > * > pre`,
		node,
	);

	if (codeBlock && classNames.some((className) => CODE_BLOCK_REGEX.test(className))) {
		console.log("codeBlock", classNames);

		const codeValue = trimTrailingLines(toText(codeBlock)).trim();

		const filenameElement = select(CODE_FILENAME_SELECTORS, node);
		const fileLang = filenameElement ? toString(filenameElement).match(/\.(\w+)$/)?.[1] : null;

		const lang =
			fileLang ||
			classNames.find((className) => /^language-/.test(className))?.replace(/^language-/, "") ||
			detectLanguage(codeValue) ||
			null;

		const result: Code = { type: "code", lang, meta: null, value: codeValue };
		state.patch(node, result);
		return result;
	}

	return defaultHandlers.div(state, node);
};
