import type { Element, Nodes as Hast } from "hast";
import { select } from "hast-util-select";
import { filter } from "unist-util-filter";
import type { ExtractParams } from "./types";

const REMOVE_REGEX =
	/fallback|icon|header|nav|speechify-ignore|assist|-ad-|banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|assist|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i;

export const stronglyExtractHast = (params: ExtractParams): Hast => {
	const { hast } = params;
	const selectors = ["article", "#article", "#content", "main", "div.container"];
	let selectedElement = hast;
	for (const selector of selectors) {
		const element = select(selector, hast);
		if (element) {
			selectedElement = element;
			break;
		}
	}

	const removedElements = filter(selectedElement, (node) => {
		if (node.type === "comment") {
			return false;
		}
		if (node.type !== "element") {
			return true;
		}
		const element = node as Element;
		const elementName = `${element.tagName} ${element.properties.id} ${element.properties.className}`;
		if (REMOVE_REGEX.test(elementName)) {
			return false;
		}
		return true;
	});

	return removedElements as Hast;
};
