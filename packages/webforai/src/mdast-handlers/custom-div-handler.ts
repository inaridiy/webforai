import { select } from "hast-util-select";
import { type Handle, defaultHandlers } from "hast-util-to-mdast";
import { toString as hastToString } from "hast-util-to-string";
import type { Code } from "mdast";
import { trimTrailingLines } from "trim-trailing-lines";
import { detectLanguage } from "../utils/detect-code-lang";
import { classList, collectElements, isElement } from "../utils/hast-fast";
import { preText } from "../utils/pre-text";
import { codeLanguage, codeMeta } from "./custom-code-handler";

const CODE_BLOCK_REGEX = /highlight-source|language-|codegroup|codeblock|code-block/i;

const CODE_FILENAME_SELECTORS = "[class*='fileName'],[class*='fileName'],[class*='title'],[class*='Title']";

export const customDivHandler: Handle = (state, node) => {
	const classNames = classList(node);
	if (!classNames.some((className) => CODE_BLOCK_REGEX.test(className))) {
		return defaultHandlers.div(state, node);
	}
	const codeBlocks = collectElements(node, (element) => element.tagName === "pre");
	// Tab groups contain several examples. Collapsing their wrapper would keep only one.
	const codeBlock = codeBlocks.length === 1 ? codeBlocks[0] : undefined;

	if (codeBlock) {
		const codeValue = trimTrailingLines(preText(codeBlock));

		const filenameElement = select(CODE_FILENAME_SELECTORS, node);
		const fileLang = filenameElement ? hastToString(filenameElement).match(/\.(\w+)$/)?.[1] : null;

		const code = codeBlock.children.find((child) => isElement(child) && child.tagName === "code");
		const classLang = codeLanguage(...(isElement(code) ? [code, codeBlock, node] : [codeBlock, node]));

		const lang = fileLang || classLang || detectLanguage(codeValue) || null;

		const result: Code = { type: "code", lang, meta: codeMeta(codeBlock), value: codeValue };
		state.patch(node, result);
		return result;
	}

	return defaultHandlers.div(state, node);
};
