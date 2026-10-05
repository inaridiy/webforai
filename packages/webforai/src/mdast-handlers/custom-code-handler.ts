import type { Element } from "hast";
import type { Handle } from "hast-util-to-mdast";
import type { Code } from "mdast";
import { trimTrailingLines } from "trim-trailing-lines";
import { detectLanguage } from "../utils/detect-code-lang";
import { classList, isElement } from "../utils/hast-fast";
import { preText } from "../utils/pre-text";
import { cleanTwoslash } from "./twoslash";

const LANGUAGE_MATCH_REGEX = [/^language-(\S+)$/, /^highlight-source-(\S+)$/, /^CodeBlock--language-(\S+)$/];

/** A token usable as a fence info string. */
const LANGUAGE_TOKEN = /^[\w+#.-]+$/;

/** Names that say "no language"; a fence without an info string says the same thing. */
const NO_LANGUAGE = new Set(["plain", "plaintext", "text", "none", "nohighlight"]);

/** Highlighters that do not use classes (Shiki via rehype-pretty-code, Prism plugins) say it here. */
const LANGUAGE_ATTRIBUTES = ["dataLanguage", "dataLang"] as const;

const attributeLanguage = (element: Element): string | undefined => {
	for (const name of LANGUAGE_ATTRIBUTES) {
		const value = element.properties?.[name];
		if (typeof value === "string" && LANGUAGE_TOKEN.test(value.trim()) && value.trim() !== "plaintext") {
			return value.trim();
		}
	}
	return undefined;
};

/**
 * Sandpack (react.dev and other CodeSandbox embeds) names the editor's language as an `sp-*`
 * class (`sp-cm sp-pristine sp-javascript`). Every other `sp-*` class is layout or syntax
 * colouring (`sp-wrapper`, `sp-syntax-keyword`), so only these names count.
 */
const SANDPACK_LANGUAGES = new Set([
	"javascript",
	"typescript",
	"jsx",
	"tsx",
	"html",
	"css",
	"less",
	"scss",
	"sass",
	"json",
	"markdown",
	"python",
	"vue",
	"svelte",
]);

/**
 * Languages written in a class convention other than `language-*`:
 *
 * - SyntaxHighlighter's `brush: js` (MDN, older WordPress plugins). The class list splits it into
 *   `brush:` and `js`; `brush:js` without the space is accepted too.
 * - Sandpack's `sp-<language>`, restricted to {@link SANDPACK_LANGUAGES}.
 */
const conventionLanguage = (element: Element): string | undefined => {
	const classes = classList(element);
	const brushAt = classes.findIndex((name) => name.startsWith("brush:"));
	if (brushAt >= 0) {
		const brush = classes[brushAt] === "brush:" ? classes[brushAt + 1] : classes[brushAt].slice("brush:".length);
		const lang = brush?.toLowerCase();
		return lang && LANGUAGE_TOKEN.test(lang) && !NO_LANGUAGE.has(lang) ? lang : undefined;
	}
	const sandpack = classes.find((name) => name.startsWith("sp-") && SANDPACK_LANGUAGES.has(name.slice(3)));
	return sandpack?.slice(3);
};

/**
 * The language a code block declares in its markup, most specific source first: a
 * `language-*`-style class, then a `data-language`/`data-lang` attribute, then the
 * {@link conventionLanguage} class conventions.
 */
export const codeLanguage = (...elements: Element[]): string | undefined =>
	elements
		.flatMap(classList)
		.map((className) => LANGUAGE_MATCH_REGEX.map((regex) => className.match(regex)).find(Boolean)?.[1])
		.find(Boolean) ??
	elements.map(attributeLanguage).find(Boolean) ??
	elements.map(conventionLanguage).find(Boolean);

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
	const twoslashLang = cleanTwoslash(node);
	const code = node.children.find((child) => isElement(child) && child.tagName === "code");
	const codeValue = trimTrailingLines(preText(node));
	const classLang = twoslashLang || codeLanguage(...(isElement(code) ? [code, node] : [node]));

	const lang = classLang || detectLanguage(codeValue) || null;

	const result: Code = { type: "code", lang, meta: codeMeta(node), value: codeValue };
	state.patch(node, result);
	return result;
};
