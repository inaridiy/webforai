import type { Element, Nodes as Hast } from "hast";
import { select } from "hast-util-select";
import { toString as hastToString } from "hast-util-to-string";
import { filter } from "unist-util-filter";
import type { ExtractParams } from "../types";
import { classnames, isStrInclude, matchString } from "./utils";

const UNLIKELY_ROLES = ["menu", "menubar", "complementary", "navigation", "alert", "alertdialog", "dialog"];

/*
 * This section of the code is influenced by @mozilla/readability, licensed under Apache License 2.0.
 * Original copyright (c) 2010 Arc90 Inc
 * See https://github.com/mozilla/readability for the full license text.
 * Modifications made by inaridiy
 * - Added and edited some regular expressions.
 */
const REGEXPS = {
	hidden: /hidden|invisible|fallback-image/i,
	byline: /byline|author|dateline|writtenby|p-author/i,
	specialUnlikelyCandidates: /frb-|uls-menu|language-link/i,
	unlikelyCandidates:
		/-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|tooltip|disqus|extra|footer|gdpr|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote|speechify-ignore|avatar/i,
	okMaybeItsaCandidate: /and|article|body|column|content|main|shadow|code/i,
};

const metadataFilter = (node: Hast) => {
	return !(
		["comment", "doctype"].includes(node.type) ||
		(node.type === "element" && ["script", "style", "link", "meta", "noscript", "svg", "title"].includes(node.tagName))
	);
};

const universalElementFilter = (node: Hast) => {
	if (node.type !== "element") {
		return true;
	}
	const element = node as Element;

	if (["aside", "nav"].includes(element.tagName)) {
		return false;
	}

	// Remove elements with hidden properties
	if (["hidden", "aria-hidden"].some((key) => element.properties[key])) {
		return false;
	}
	if (classnames(element).some((classname) => REGEXPS.hidden.test(classname))) {
		return false;
	}

	// Remove dialog elements
	if (element.tagName === "dialog") {
		return false;
	}
	if (element.properties.role === "dialog" && element.properties["aria-modal"]) {
		return false;
	}

	// Remove byline elements
	if (element.properties.rel === "author" && isStrInclude(element.properties.itemprop, "author")) {
		return false;
	}
	if (REGEXPS.byline.test(matchString(element))) {
		return false;
	}

	// Remove unlikely roles
	if (element.properties.role && UNLIKELY_ROLES.includes(element.properties.role as string)) {
		return false;
	}

	return true;
};

/**
 * Simple filter to remove unwanted elements from the HAST tree.
 *
 * @param params - {@link ExtractParams}
 * @returns The HAST tree.
 */
export const minimalFilter = (params: ExtractParams): Hast => {
	const { hast } = params;
	const body = select("body", hast) ?? hast;

	const metadataFilteredHast = filter(body, (node) => metadataFilter(node as Hast));
	const metadataFilteredHastText = metadataFilteredHast && hastToString(metadataFilteredHast);
	if (!(metadataFilteredHast && metadataFilteredHastText)) {
		return body;
	}

	const baseFilterd = filter(metadataFilteredHast, (node) => universalElementFilter(node as Hast));
	const baseFilterdText = baseFilterd ? hastToString(baseFilterd) : "";

	const isOverExtracted = baseFilterdText.length > metadataFilteredHastText.length / 3 || baseFilterdText.length > 5000;
	const baseTree = isOverExtracted && baseFilterd ? baseFilterd : metadataFilteredHast;

	return baseTree;
};
