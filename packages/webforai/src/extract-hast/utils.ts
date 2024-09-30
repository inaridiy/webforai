import type { Element } from "hast";

export const matchString = (element: Element) =>
	`${element.tagName} ${element.properties.id} ${classnames(element).join(" ")}`;

export const classnames = (element: Element) => {
	if (Array.isArray(element.properties.className)) {
		return element.properties.className as string[];
	}
	return [];
};

export const isStrInclude = (value: unknown, match: string) => {
	if (typeof value === "string") {
		return value.includes(match);
	}
	return false;
};
