import type { Element, ElementContent } from "hast";

import { classList, isElement } from "../utils/hast-fast";
import { preText } from "../utils/pre-text";

/**
 * Cleans a shiki-twoslash code block in place, returning the language it declares.
 *
 * Twoslash (the TypeScript handbook and many TS blogs) decorates the code inside `<pre>` itself:
 * a `div.language-id` naming the language, a "Try" playground link, and each compiler error twice
 * — a visible `span.error` box and an invisible `span.error-behind` copy. Read as text, every
 * block opened with a stray `ts` line and ended with `…'string'.2345Argument of type…Try`.
 *
 * The language moves to the fence, the link and the invisible copy go, and each error becomes a
 * line of its own in the compiler's own wording (`// error TS2345: …`), which keeps the point the
 * example makes while staying valid TypeScript.
 */
export const cleanTwoslash = (pre: Element): string | undefined => {
	if (!classList(pre).includes("twoslash")) {
		return undefined;
	}

	let language: string | undefined;

	const clean = (element: Element): void => {
		element.children = element.children.flatMap((child): ElementContent[] => {
			if (!isElement(child)) {
				return [child];
			}
			const classes = classList(child);
			if (classes.includes("language-id")) {
				language ||= preText(child).trim() || undefined;
				return [];
			}
			if (classes.includes("playground-link") || classes.includes("error-behind")) {
				return [];
			}
			if (classes.includes("error")) {
				return [errorLine(child)];
			}
			clean(child);
			return [child];
		});
	};

	clean(pre);
	return language && /^[\w+#.-]+$/.test(language) ? language : undefined;
};

/** `// error TS2345: Argument of type …`, as its own line. */
const errorLine = (error: Element): Element => {
	let code = "";
	let message = "";
	for (const child of error.children) {
		if (isElement(child) && classList(child).includes("code")) {
			code = preText(child).trim();
		} else {
			message += isElement(child) ? preText(child) : child.type === "text" ? child.value : "";
		}
	}

	const prefix = /^\d+$/.test(code) ? `error TS${code}: ` : "error: ";
	const lines = `${prefix}${message.trim()}`.split("\n").map((line) => `// ${line}`);
	return { type: "element", tagName: "div", properties: {}, children: [{ type: "text", value: lines.join("\n") }] };
};
