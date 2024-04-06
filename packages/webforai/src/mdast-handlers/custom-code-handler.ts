import type { Handle } from "hast-util-to-mdast";
import { toText } from "hast-util-to-text";
import { Code } from "mdast";
import { trimTrailingLines } from "trim-trailing-lines";
import { detectLanguage } from "../utils/detect-code-lang";

const LANGUAGE_MATCH_REGEX = [/language-(\w+)/, /highlight-source-(\w+)/, /CodeBlock--language-(\w+)/];

export const customCodeHandler: Handle = (state, node) => {
	const classNames = (node.properties?.className as string[]) || [];
	const codeValue = trimTrailingLines(toText(node)).trim();

	const classLang = classNames
		.map((className) => {
			const match = LANGUAGE_MATCH_REGEX.map((regex) => className.match(regex)).find((match) => match);
			return match?.[1];
		})
		.find((className) => className);

	const lang = classLang || detectLanguage(codeValue) || null;

	const result: Code = { type: "code", lang, meta: null, value: codeValue };
	state.patch(node, result);
	return result;
};
