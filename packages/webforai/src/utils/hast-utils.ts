import type { Element, Nodes as Hast } from "hast";
import { select, selectAll } from "hast-util-select";

export const getLangFromHast = (node: Hast) => {
	const html = select("html", node);
	if (html && typeof html.properties.lang === "string") {
		return html.properties.lang;
	}
	if (node.type !== "element") {
		return;
	}
	const element = node as Element;
	if (element.tagName !== "html") {
		return;
	}

	const langAttr = element.properties.lang || element.properties["xml:lang"];
	if (langAttr) {
		return langAttr as string;
	}

	return undefined;
};

export const getLangFromStr = (str: string) => {
	const match = str.match(/lang=["']([^"']+)["']/);
	if (match) {
		return match[1];
	}
	return undefined;
};

export const getUrlFromHast = (node: Hast): string | undefined => {
	if (node.type !== "element") {
		return undefined;
	}

	const metaTagAttributes = ["og:url", "twitter:url"];
	const metaTags = selectAll("meta", node);

	for (const meta of metaTags) {
		const property = meta.properties.property || meta.properties.name;
		if (typeof property === "string" && metaTagAttributes.includes(property)) {
			return typeof meta.properties.content === "string" ? meta.properties.content : undefined;
		}
	}

	return undefined;
};
