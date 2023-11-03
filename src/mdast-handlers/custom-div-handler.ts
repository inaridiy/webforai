import { Handle, defaultHandlers } from "hast-util-to-mdast";
import { toText } from "hast-util-to-text";
import { Code } from "mdast";
import { trimTrailingLines } from "trim-trailing-lines";

export const customDivHandler: Handle = (state, node) => {
  const classNames = Array.isArray(node.properties.className) ? node.properties.className : [];

  let highlightLanguage: string | undefined;
  for (const className of classNames) {
    if (String(className) === "highlight-text-html-basic") {
      highlightLanguage = "html";
      break;
    } else if (String(className).includes("highlight-source-")) {
      highlightLanguage = String(className).slice("highlight-source-".length);
      break;
    } else if (String(className).includes("language-")) {
      highlightLanguage = String(className).slice("language-".length);
      break;
    } else if (String(className).includes("code-block_wrapper")) {
      const text = toText(node);
      if (!text.includes(".")) break;
      const lang = toText(node).split("\n")[0].split(".").slice(-1)[0];
      highlightLanguage = lang;
      break;
    }
  }

  if (highlightLanguage !== undefined) {
    const code =
      node.children.find((child) => child.type === "element" && child.tagName === "pre") || node;

    const result: Code = {
      type: "code",
      lang: highlightLanguage,
      meta: null,
      value: trimTrailingLines(toText(code)).trim(),
    };
    state.patch(node, result);
    return result;
  }

  return defaultHandlers.div(state, node);
};
