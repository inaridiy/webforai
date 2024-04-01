import type { Element } from "hast";

export const matchString = (element: Element) =>
	`${element.tagName} ${element.properties.id} ${classnames(element).join(" ")} }`;

export const classnames = (element: Element) => {
	if (Array.isArray(element.properties.className)) return element.properties.className as string[];
	return [];
};

export const isStrInclude = (value: unknown, match: string) => {
	if (typeof value === "string") return value.includes(match);
	return false;
};

export const hasAncestors = (element: Element, tagNames: string[], depth = 3) => {
	let parent = element.parent;
	for (let i = 0; i < depth; i++) {
		if (!parent || parent.type !== "element") return false;
		if (tagNames.includes(parent.tagName)) return true;
		parent = parent.parent;
	}
	return false;
};
