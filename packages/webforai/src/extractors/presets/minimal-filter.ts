/**
 * A light-touch extractor.
 *
 * Where {@link takumiExtractor} tries to isolate the article, this only removes what is
 * unambiguously not content: metadata elements, invisible nodes and obvious page chrome. Use it
 * when you would rather keep some boilerplate than risk losing part of the page — full-page
 * archiving, diffing, or feeding a model that does its own filtering.
 */

import type { Element, Nodes as Hast } from "hast";

import {
	MetricsCollector,
	cloneHast,
	findElement,
	isElement,
	isTruthyAttribute,
	matchString,
	pruneInPlace,
	stringProperty,
} from "../../utils/hast-fast";
import { REGEXPS, UNLIKELY_ROLES } from "../lib/constants";
import { stripNonContent } from "../lib/sanitize";
import type { ExtractParams } from "../types";

/** Fraction of the input text the filtered tree must retain to be trusted. */
const MIN_RETAINED_FRACTION = 1 / 3;

/** Below this the retention ratio is meaningless, so the result is kept regardless. */
const ALWAYS_ACCEPT_LENGTH = 5000;

const isChrome = (element: Element): boolean => {
	if (element.tagName === "aside" || element.tagName === "nav" || element.tagName === "dialog") {
		return true;
	}

	const role = stringProperty(element, "role");
	if (role && UNLIKELY_ROLES.has(role)) {
		return true;
	}
	if (role === "dialog" && isTruthyAttribute(element, "aria-modal")) {
		return true;
	}

	// Bylines are metadata rather than article text.
	if (stringProperty(element, "rel") === "author") {
		return true;
	}
	if (REGEXPS.byline.test(matchString(element))) {
		return true;
	}

	return false;
};

/**
 * Removes unwanted elements from a HAST tree without attempting to locate the article.
 *
 * @param params - {@link ExtractParams}
 * @returns The filtered HAST tree.
 */
export const minimalFilter = (params: ExtractParams): Hast => {
	const { hast } = params;

	const body = cloneHast(findElement(hast, (element) => element.tagName === "body") ?? hast);
	stripNonContent(body);

	const collector = new MetricsCollector();
	const baseText = collector.textLength(body);
	if (baseText === 0) {
		return body;
	}

	const filtered = cloneHast(body);
	pruneInPlace(filtered, (node) => !(isElement(node) && isChrome(node)));

	const filteredText = new MetricsCollector().textLength(filtered);
	const isOverExtracted = filteredText < baseText * MIN_RETAINED_FRACTION && filteredText < ALWAYS_ACCEPT_LENGTH;

	return isOverExtracted ? body : filtered;
};
