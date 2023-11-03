import type { Nodes as Mdast, RootContent } from "mdast";

export const unwarpRoot = (mdast: Mdast): RootContent[] => {
	if (mdast.type === "root") return mdast.children;
	return [mdast];
};

export const warpRoot = (mdast: RootContent[] | Mdast): Mdast => {
	if (Array.isArray(mdast)) return { type: "root", children: mdast };
	return mdast;
};

export const internalType = (content: RootContent): string => {
	if (content.type === "heading") return `h${content.depth}`;
	return content.type;
};
