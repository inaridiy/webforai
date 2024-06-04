import { select } from "hast-util-select";
import { type Handle, defaultHandlers } from "hast-util-to-mdast";
import { toString as hastToString } from "hast-util-to-string";
import { toText } from "hast-util-to-text";
import type { Code } from "mdast";
import { trimTrailingLines } from "trim-trailing-lines";
import { detectLanguage } from "../utils/detect-code-lang";

const CODE_BLOCK_REGEX = /highlight-source|language-|codegroup|codeblock|code-block/i;

const CODE_FILENAME_SELECTORS = "[class*='fileName'],[class*='fileName'],[class*='title'],[class*='Title']";

const LANGUAGE_MATCH_REGEX = [/language-(\w+)/, /highlight-source-(\w+)/, /CodeBlock--language-(\w+)/];

const findRecursive = <T>(array: T[], condition: (value: T) => boolean | T[], maxDepth = 3): T | null => {
	if (maxDepth <= 0) {
		return null;
	}
	for (const value of array) {
		const result = condition(value);
		if (Array.isArray(result)) {
			return findRecursive(result, condition, maxDepth - 1);
		}
		if (result) {
			return value;
		}
	}

	return null;
};
export const customDivHandler: Handle = (state, node) => {
	const classNames = Array.isArray(node.properties.className) ? (node.properties.className as string[]) : [];
	const codeBlock = findRecursive(node.children, (child) => {
		if (child.type !== "element") {
			return false;
		}
		if (child.tagName === "pre") {
			return true;
		}
		return child.children.filter((child) => child.type === "element");
	});

	if (codeBlock && classNames.some((className) => CODE_BLOCK_REGEX.test(className))) {
		const codeBlockClassNames = codeBlock.type === "element" ? (codeBlock.properties.className as string[]) ?? [] : [];
		const codeValue = trimTrailingLines(toText(codeBlock)).trim();

		const filenameElement = select(CODE_FILENAME_SELECTORS, node);
		const fileLang = filenameElement ? hastToString(filenameElement).match(/\.(\w+)$/)?.[1] : null;

		const classLang = [...classNames, ...codeBlockClassNames]
			.map((className) => {
				const match = LANGUAGE_MATCH_REGEX.map((regex) => className.match(regex)).find((match) => match);

				return match?.[1];
			})
			.find((className) => className);

		const lang = fileLang || classLang || detectLanguage(codeValue) || null;

		const result: Code = { type: "code", lang, meta: null, value: codeValue };
		state.patch(node, result);
		return result;
	}

	return defaultHandlers.div(state, node);
};
