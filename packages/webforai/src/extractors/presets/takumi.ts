import type { Element, Nodes as Hast } from "hast";
import { select, selectAll } from "hast-util-select";
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
		/-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|tooltip|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote|speechify-ignore|avatar/i,
	okMaybeItsaCandidate: /and|article|body|column|content|main|shadow|code/i,
};

const BODY_SELECTORS = ["article", "#article", ".article_body", ".article-body", "#content", ".entry"];

const PARAGRAPH_TAGS = ["a", "p", "div", "section", "article", "main", "ul", "ol", "li"];

const BASE_MINIMAL_LENGTH = {
	ja: 200,
	en: 500,
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

const unlikelyElementFilter = (node: Hast) => {
	if (node.type !== "element") {
		return true;
	}
	const element = node as Element;

	// Skip main content elements
	if (["body", "article", "main", "section", "h1", "h2", "h3", "h4", "h5", "h6", "p"].includes(element.tagName)) {
		return true;
	}
	const match = matchString(element);

	if (REGEXPS.specialUnlikelyCandidates.test(match)) {
		return false;
	}

	// Remove unlikely candidates
	if (REGEXPS.unlikelyCandidates.test(match) && !REGEXPS.okMaybeItsaCandidate.test(match)) {
		return false;
	}

	return true;
};

const removeEmptyFilter = (node: Hast, _lang: string) => {
	if (node.type !== "element") {
		return true;
	}
	const element = node as Element;

	if (PARAGRAPH_TAGS.includes(element.tagName)) {
		return true;
	}

	if (element.tagName === "img" && !element.properties.src) {
		return false;
	}

	return true;
};

/**
 * Currently the best Extractor.
 * The word "takumi" is written as 匠 in Japanese, and it refers to a highly skilled artisan or craftsman.
 *
 * @param params - {@link ExtractParams}
 * @returns The HAST tree.
 */
export const takumiExtractor = (params: ExtractParams): Hast => {
	const { hast, lang = "en" } = params;
	const body = select("body", hast) ?? hast;

	const metadataFilteredHast = filter(body, (node) => metadataFilter(node as Hast));
	const metadataFilteredHastText = metadataFilteredHast && hastToString(metadataFilteredHast);
	if (!(metadataFilteredHast && metadataFilteredHastText)) {
		return body;
	}

	const baseFilterd = filter(metadataFilteredHast, (node) => universalElementFilter(node as Hast));
	const baseFilterdText = baseFilterd ? hastToString(baseFilterd) : "";
	const [baseTree, baseText] =
		baseFilterdText.length > metadataFilteredHastText.length / 3 || baseFilterdText.length > 5000
			? ([baseFilterd as Hast, baseFilterdText] as const)
			: ([metadataFilteredHast as Hast, metadataFilteredHastText] as const);

	let minimalLength = lang in BASE_MINIMAL_LENGTH ? BASE_MINIMAL_LENGTH[lang as keyof typeof BASE_MINIMAL_LENGTH] : 500;
	if (baseText.length < minimalLength) {
		minimalLength = Math.max(0, baseText.length - 200);
	}

	let extractedTree: Hast = baseTree;
	let extractedText = baseText;

	for (const selector of BODY_SELECTORS) {
		const content = { type: "root" as const, children: selectAll(selector, baseFilterd) };
		const contentText = hastToString(content);

		if (contentText.length < 25) {
			continue;
		}

		const links = selectAll("a", content);
		const linkText = links.map((link) => hastToString(link)).join("");

		const linkDensity = linkText.length / contentText.length;
		if (linkDensity > 0.4) {
			continue;
		}

		if (contentText.length > minimalLength) {
			extractedTree = content;
			extractedText = contentText;
			break;
		}
	}

	const finalFilteredTree = filter(extractedTree, (node) => {
		if (!removeEmptyFilter(node as Hast, lang)) {
			return false;
		}
		if (!unlikelyElementFilter(node as Hast)) {
			return false;
		}

		return true;
	}) as Hast;

	const finalTree =
		hastToString(finalFilteredTree).length > extractedText.length / 3 ? finalFilteredTree : extractedTree;
	return finalTree;
};
