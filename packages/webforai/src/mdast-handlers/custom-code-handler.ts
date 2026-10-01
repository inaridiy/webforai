import type { Element } from "hast";
import type { Handle } from "hast-util-to-mdast";
import { toText } from "hast-util-to-text";
import type { Code } from "mdast";
import { trimTrailingLines } from "trim-trailing-lines";
import { detectLanguage } from "../utils/detect-code-lang";
import { classList, isElement } from "../utils/hast-fast";

const LANGUAGE_MATCH_REGEX = [/^language-(\S+)$/, /^highlight-source-(\S+)$/, /^CodeBlock--language-(\S+)$/];

/** Highlighters that do not use classes (Shiki via rehype-pretty-code, Prism plugins) say it here. */
const LANGUAGE_ATTRIBUTES = ["dataLanguage", "dataLang"] as const;

const attributeLanguage = (element: Element): string | undefined => {
	for (const name of LANGUAGE_ATTRIBUTES) {
		const value = element.properties?.[name];
		if (typeof value === "string" && /^[\w+#.-]+$/.test(value.trim()) && value.trim() !== "plaintext") {
			return value.trim();
		}
	}
	return undefined;
};

export const codeLanguage = (...elements: Element[]): string | undefined =>
	elements
		.flatMap(classList)
		.map((className) => LANGUAGE_MATCH_REGEX.map((regex) => className.match(regex)).find(Boolean)?.[1])
		.find(Boolean) ?? elements.map(attributeLanguage).find(Boolean);

export const customCodeHandler: Handle = (state, node) => {
	const code = node.children.find((child) => isElement(child) && child.tagName === "code");
	const codeValue = trimTrailingLines(toText(node));
	const classLang = codeLanguage(...(isElement(code) ? [code, node] : [node]));

	const lang = classLang || detectLanguage(codeValue) || null;

	const result: Code = { type: "code", lang, meta: null, value: codeValue };
	state.patch(node, result);
	return result;
};
