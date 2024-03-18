import type { Element, Nodes as Hast } from "hast";
import { select } from "hast-util-select";
import { toText } from "hast-util-to-text";
import { filter } from "unist-util-filter";

const evaluateTextComplexity = (text: string) => {
	const words = text.trim().split(/\s+/);
	const wordCount = words.length;

	const charCount = text.length;

	const avgWordLength = charCount / wordCount;

	const uniqueWords = new Set(words);
	const uniqueWordCount = uniqueWords.size;

	const complexityScore = avgWordLength * 0.4 + (uniqueWordCount / wordCount) * 100 * 0.6;

	return {
		wordCount,
		charCount,
		avgWordLength,
		uniqueWordCount,
		complexityScore,
	};
};

const REMOVE_REGEX =
	/icon|header|nav|speechify-ignore|assist|-ad-|banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|assist|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i;
const HIDDEN_REGEX = /hidden|^hid$| hid$| hid |^hid /i;

export const stronglyExtractHast = (hast: Hast): Hast => {
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
		if (node.type === "comment") return false;
		if (node.type !== "element") return true;
		const element = node as Element;
		const elementName = `${element.tagName} ${element.properties.id} ${element.properties.className}`;
		if (REMOVE_REGEX.test(elementName)) return false;
		const isHidden = HIDDEN_REGEX.test(elementName);
		const complexity = evaluateTextComplexity(toText(element));
		if (isHidden && complexity.complexityScore < 40) return false;
		return true;
	});

	return removedElements as Hast;
};
