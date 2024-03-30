import type { Element, Nodes as Hast } from "hast";
import { selectAll } from "hast-util-select";
import { toText } from "hast-util-to-text";
import { filter } from "unist-util-filter";
import { parents } from "unist-util-parents";
import { classnames, hasAncestors, isStrInclude, matchString } from "./utils";

type ProxiedHast = Hast & { parent: ProxiedHast | null };

declare module "hast" {
	interface Element {
		parent: ProxiedHast | null;
	}
}

const UNLIKELY_ROLES = ["menu", "menubar", "complementary", "navigation", "alert", "alertdialog", "dialog"];

const REGEXPS = {
	hidden: /hidden|invisible|fallback-image/i,
	byline: /byline|author|dateline|writtenby|p-author/i,
	unlikelyCandidates:
		/-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote|speechify-ignore/i,
	okMaybeItsACandidate: /and|article|body|column|content|main|shadow/i,
};

const BODY_SELECTORS = ["article", "#article", ".article_body", ".article-body", "#content", ".entry", "main"];

const metadataFilter = (node: Hast) => !["comment", "doctype"].includes(node.type);

const universalElementFilter = (node: Hast) => {
	if (node.type !== "element") return true;
	const element = node as Element;

	// Remove blacklisted elements
	if (["script", "aside"].includes(element.tagName)) return false;

	// Remove elements with hidden properties
	if (["hidden", "aria-hidden"].some((key) => element.properties[key])) return false;
	if (classnames(element).some((classname) => REGEXPS.hidden.test(classname))) return false;

	// Remove dialog elements
	if (element.tagName === "dialog") return false;
	if (element.properties.role === "dialog" && element.properties["aria-modal"]) return false;

	// Remove byline elements
	if (element.properties.rel === "author" && isStrInclude(element.properties.itemprop, "author")) return false;
	if (REGEXPS.byline.test(matchString(element))) return false;

	// Remove unlikely roles
	if (element.properties.role && UNLIKELY_ROLES.includes(element.properties.role as string)) return false;

	return true;
};

const unlikelyElementFilter = (node: Hast) => {
	if (node.type !== "element") return true;
	const element = node as Element;
	const match = matchString(element);

	// Skip main content elements
	if (["body", "article", "main", "section", "a"].includes(element.tagName)) return true;
	if (hasAncestors(element, ["table", "code"], 3)) return true;

	// Remove unlikely candidates
	if (REGEXPS.unlikelyCandidates.test(match) && !REGEXPS.okMaybeItsACandidate.test(match)) return false;

	return true;
};

export const readabilityExtractHast = (hast: Hast): Hast => {
	const proxiedHast = parents(hast) as unknown as ProxiedHast;
	let baseFilterd = filter(proxiedHast, (node) => {
		if (!metadataFilter(node as Hast)) return false;
		if (!universalElementFilter(node as Hast)) return false;
		return true;
	}) as Hast;

	const baseText = toText(baseFilterd);
	let minimalLength = 500;
	if (baseText.length > 500) {
		baseFilterd = filter(baseFilterd, (node) => {
			if (!unlikelyElementFilter(node as Hast)) return false;
			return true;
		}) as Hast;
	} else minimalLength = Math.max(0, baseText.length - 200);

	let bodyTree = baseFilterd;
	for (const selector of BODY_SELECTORS) {
		const body = { type: "root" as const, children: selectAll(selector, baseFilterd) };
		const bodyText = toText(body);

		if (bodyText.length < 25) continue;

		const links = selectAll("a", body);
		const linkText = links.map((link) => toText(link)).join("");

		const linkDensity = linkText.length / bodyText.length;
		if (linkDensity > 0.4) continue;

		if (bodyText.length > minimalLength) {
			bodyTree = body;
			break;
		}
	}

	return bodyTree;
};
