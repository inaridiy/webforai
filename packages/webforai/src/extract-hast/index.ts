import type { Element, Nodes as Hast } from "hast";
import { select } from "hast-util-select";
import { filter } from "unist-util-filter";

const REMOVE_REGEX =
	/header|nav|speechify-ignore|assist|-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|assist|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i;

export const extractHast = (hast: Hast): Hast => {
	const selectors = ["article", "div#article", "main", "div.container"];
	let selectedElement = hast;
	for (const selector of selectors) {
		const element = select(selector, hast);
		if (element) {
			selectedElement = element;
			break;
		}
	}

	const removedElements = filter(selectedElement, (node) => {
		if (node.type !== "element") return true;
		const element = node as Element;
		const elementName = `${element.tagName} ${element.properties.id} ${element.properties.className}`;
		return !REMOVE_REGEX.test(elementName);
	});

	return removedElements as Hast;
};
