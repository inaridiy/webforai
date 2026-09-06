import type { Nodes as Mdast } from "mdast";

const absoluteUrl = (url: string, base: string): string => {
	if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(url)) {
		return url;
	}
	try {
		return new URL(url, base).href;
	} catch {
		return url;
	}
};

/** Resolve only actual destinations before serialization, preserving code and caller trees. */
export const linkReplacer = <T extends Mdast>(node: T, base: string): T => {
	let result = node;
	if (node.type === "link" || node.type === "image" || node.type === "definition") {
		result = { ...node, url: absoluteUrl(node.url, base) };
	}
	if ("children" in result) {
		return { ...result, children: result.children.map((child) => linkReplacer(child, base)) };
	}
	return result;
};
