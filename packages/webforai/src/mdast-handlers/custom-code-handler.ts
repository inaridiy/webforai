import type { Element } from "hast";
import type { Handle } from "hast-util-to-mdast";
import type { Code } from "mdast";
import { trimTrailingLines } from "trim-trailing-lines";
import { detectLanguage } from "../utils/detect-code-lang";
import { classList, isElement } from "../utils/hast-fast";
import { preText } from "../utils/pre-text";

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

/**
 * Fence meta carrying the block's caption, from `data-title`.
 *
 * Set by documentation generators on titled blocks and by the extractor on code taken from a
 * labelled tab (`client.ts`, `pnpm`). Written as `title="…"`, the form those generators accept.
 */
export const codeMeta = (pre: Element): string | null => {
	const title = pre.properties?.dataTitle;
	if (typeof title !== "string") {
		return null;
	}
	const clean = title.replace(/["\r\n]+/g, " ").trim();
	return clean ? `title="${clean}"` : null;
};

export const customCodeHandler: Handle = (state, node) => {
	const code = node.children.find((child) => isElement(child) && child.tagName === "code");
	const codeValue = trimTrailingLines(preText(node));
	const classLang = codeLanguage(...(isElement(code) ? [code, node] : [node]));

	const lang = classLang || detectLanguage(codeValue) || null;

	const result: Code = { type: "code", lang, meta: codeMeta(node), value: codeValue };
	state.patch(node, result);
	return result;
};
