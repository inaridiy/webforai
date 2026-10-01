/**
 * Removal passes used before and after candidate selection.
 *
 * Everything here mutates the tree in place via `pruneInPlace`, so a single traversal removes a
 * whole class of nodes. Callers are responsible for cloning first when the input must survive.
 */

import type { Element, Nodes as Hast, Parent } from "hast";

import {
	type MetricsCollector,
	MetricsCollector as MetricsCollectorCtor,
	classList,
	isElement,
	isTruthyAttribute,
	matchString,
	numericProperty,
	pruneInPlace,
	stringProperty,
	walk,
} from "../../utils/hast-fast";
import {
	CHROME_TAGS,
	CONTEXTUAL_LANDMARK_TAGS,
	DROP_WHEN_EMPTY_TAGS,
	EMBEDDED_CONTENT_TAGS,
	HIDDEN_CLASS_NAMES,
	NON_CONTENT_TAGS,
	REGEXPS,
	RESPONSIVE_DISPLAY_OVERRIDE,
	UNLIKELY_ROLES,
} from "./constants";
import { isUiChromeText } from "./ui-chrome";

/** Inline styles that take an element out of the visual flow. */
const INVISIBLE_STYLE = /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)\s*(;|$)/i;

/**
 * True when a class token marks the element as not displayed.
 *
 * Tokens are compared whole. A responsive override anywhere in the list cancels the result,
 * because extraction models a desktop reader and `hidden md:block` is visible to one.
 */
const hasHiddenClass = (element: Element): boolean => {
	const classes = classList(element);
	if (!classes.some((name) => HIDDEN_CLASS_NAMES.has(name))) {
		return classes.some((name) => REGEXPS.hidden.test(name));
	}
	return !classes.some((name) => RESPONSIVE_DISPLAY_OVERRIDE.test(name));
};

/**
 * True for nodes that can never contribute content.
 *
 * Kept deliberately conservative — this pass runs before scoring, so a false positive here
 * silently deletes article text with no chance of recovery.
 */
const isNonContent = (node: Hast): boolean => {
	if (node.type === "comment" || node.type === "doctype") {
		return true;
	}
	return isElement(node) && NON_CONTENT_TAGS.has(node.tagName);
};

/**
 * True for elements the reader never saw.
 *
 * `aria-hidden` alone is not sufficient: it is routinely applied to decorative icons *inside*
 * content, and on a few frameworks to the entire pre-hydration tree. It only counts here when
 * the element also carries no visible geometry or is explicitly hidden by style.
 */
const isHidden = (element: Element): boolean => {
	// Renderers that show a formula as an image keep the authoritative MathML alongside it,
	// hidden from sighted users. It is the only lossless form of the expression on the page, so
	// visibility rules must not reach it — dropping it leaves the formula with no representation
	// at all once the image fallback is de-duplicated away.
	if (containsMath(element)) {
		return false;
	}

	if (isTruthyAttribute(element, "hidden")) {
		return true;
	}

	const style = stringProperty(element, "style");
	if (style && INVISIBLE_STYLE.test(style)) {
		return true;
	}

	if (hasHiddenClass(element)) {
		return true;
	}

	// Rendered geometry, when a loader supplied it, is the most reliable visibility signal there
	// is: a zero box means the browser laid the element out to nothing.
	const width = numericProperty(element, "data-rwidth");
	const height = numericProperty(element, "data-rheight");
	if (width === 0 && height === 0) {
		return true;
	}

	return false;
};

/** `src` values that stand in for an image until a script swaps in the real one. */
const PLACEHOLDER_IMAGE_SRC = /^data:image\/|^about:blank$|spacer\.gif$|blank\.(gif|png)$/i;

/**
 * True when an element is an image standing in for one that a script would load.
 *
 * A `<picture>` carries no `src` of its own — its candidates live on `<source srcset>` and the
 * inner `<img>` — so an absent `src` must never be read as "placeholder". Treating it as one
 * deletes ordinary responsive images that merely happen to precede a `<noscript>`.
 */
const isPlaceholderImage = (element: Element): boolean => {
	if (element.tagName === "img") {
		const src = stringProperty(element, "src");
		return src !== undefined && PLACEHOLDER_IMAGE_SRC.test(src);
	}

	if (element.tagName !== "picture") {
		return false;
	}

	// A picture is a placeholder only when the image it resolves to is one.
	for (const child of element.children) {
		if (isElement(child) && child.tagName === "img") {
			return isPlaceholderImage(child);
		}
	}
	return false;
};

/**
 * Rescues content that only exists inside `<noscript>`.
 *
 * The standard lazy-loading fallback is a placeholder `<img>` followed by a `<noscript>` holding
 * the real one. Deleting `<noscript>` as non-content — which is otherwise correct — therefore
 * discards the real image and keeps the placeholder. Readability carries a dedicated pass for
 * exactly this case, and so does this one.
 *
 * The whole noscript body is hoisted, not just its images: fallbacks routinely include a caption
 * or a paragraph alongside the image, and keeping only the image silently loses that text.
 */
export const hoistNoscriptImages = (tree: Hast): void => {
	const visit = (parent: Parent): void => {
		for (let index = 0; index < parent.children.length; index++) {
			const child = parent.children[index];
			if (!isElement(child)) {
				continue;
			}

			if (child.tagName !== "noscript") {
				visit(child);
				continue;
			}

			// Only rescue a noscript that exists to supply imagery; a scripting-required notice is
			// not content and is left for the ordinary removal pass.
			const hasImage = child.children.some(
				(node) => isElement(node) && (node.tagName === "img" || node.tagName === "picture"),
			);
			if (!hasImage) {
				continue;
			}

			const rescued = child.children;
			parent.children.splice(index, 1, ...rescued);

			// Drop the placeholder the noscript was compensating for, if there is one.
			const previous = parent.children[index - 1];
			if (index > 0 && isElement(previous) && isPlaceholderImage(previous)) {
				parent.children.splice(index - 1, 1);
				index -= 1;
			}

			index += rescued.length - 1;
		}
	};

	if ("children" in tree) {
		visit(tree as Parent);
	}
};

/** True when a subtree holds a MathML expression. */
const containsMath = (element: Element): boolean => {
	if (element.tagName === "math") {
		return true;
	}
	for (const child of element.children) {
		if (isElement(child) && containsMath(child)) {
			return true;
		}
	}
	return false;
};

/** Removes comments, metadata elements and anything the browser did not display. */
export const stripNonContent = (tree: Hast): Hast => {
	hoistNoscriptImages(tree);

	return pruneInPlace(tree, (node) => {
		if (isNonContent(node)) {
			return false;
		}
		if (isElement(node) && isHidden(node)) {
			return false;
		}
		return true;
	});
};

/**
 * Finds `<header>`/`<footer>` elements that act as page landmarks rather than section furniture.
 *
 * A landmark sits near the root and outside any `<article>`/`<main>`. The same tags nested
 * inside content hold the section's heading and byline, so they must survive — deleting them is
 * how a documentation page loses every heading it has.
 */
export const findLandmarkChrome = (tree: Hast): Set<Element> => {
	const chrome = new Set<Element>();

	const visit = (node: Hast, depth: number, insideContent: boolean): void => {
		if (!("children" in node)) {
			return;
		}

		for (const child of node.children) {
			if (!isElement(child)) {
				continue;
			}

			const nowInsideContent =
				insideContent ||
				child.tagName === "article" ||
				child.tagName === "main" ||
				stringProperty(child, "role") === "main";

			if (CONTEXTUAL_LANDMARK_TAGS.has(child.tagName) && !insideContent && depth <= 3) {
				chrome.add(child);
				continue;
			}

			visit(child, depth + 1, nowInsideContent);
		}
	};

	visit(tree, 0, false);
	return chrome;
};

/**
 * True for containers that are almost certainly page furniture.
 *
 * Mirrors Readability's unlikely-candidate rule: a class/id match condemns the element unless it
 * also looks content-ish, with a short list of patterns strong enough to skip that reprieve.
 */
const isUnlikelyCandidate = (element: Element): boolean => {
	// Semantic content elements are never furniture, whatever they are called.
	if (element.tagName === "article" || element.tagName === "main" || element.tagName === "body") {
		return false;
	}

	const role = stringProperty(element, "role");
	if (role && UNLIKELY_ROLES.has(role)) {
		return true;
	}

	if (CHROME_TAGS.has(element.tagName)) {
		return true;
	}

	const match = matchString(element);

	if (REGEXPS.specialUnlikelyCandidates.test(match)) {
		return true;
	}

	for (const name of [...classList(element), stringProperty(element, "id") ?? ""]) {
		if (REGEXPS.stronglyUnlikely.test(name)) {
			return true;
		}
	}

	if (REGEXPS.unlikelyCandidates.test(match) && !REGEXPS.okMaybeItsaCandidate.test(match)) {
		return true;
	}

	return false;
};

/**
 * Collects the elements {@link stripUnlikely} would remove, without touching the tree.
 *
 * Callers use this to price the pass before paying for it: measuring the text about to be lost
 * is far cheaper than cloning the document, pruning the copy and re-measuring the result.
 */
export const findUnlikelyElements = (tree: Hast): Element[] => {
	const landmarks = findLandmarkChrome(tree);
	const doomed: Element[] = [];

	const visit = (node: Hast): void => {
		if (!("children" in node)) {
			return;
		}
		for (const child of node.children) {
			if (!isElement(child)) {
				continue;
			}
			if (landmarks.has(child) || isUnlikelyCandidate(child)) {
				doomed.push(child);
				continue; // its subtree goes with it
			}
			visit(child);
		}
	};

	visit(tree);
	return doomed;
};

/**
 * Removes page furniture ahead of scoring.
 *
 * This pass is aggressive by design, so callers compare the surviving text against the input and
 * fall back to the unpruned tree when it cut too deep.
 */
export const stripUnlikely = (tree: Hast): Hast => {
	const doomed = new Set(findUnlikelyElements(tree));
	return pruneInPlace(tree, (node) => !(isElement(node) && doomed.has(node)));
};

/** True when an element carries meaning even though it holds no text. */
const isEmbeddedContent = (element: Element): boolean => {
	if (EMBEDDED_CONTENT_TAGS.has(element.tagName)) {
		return true;
	}
	return element.tagName === "br" || element.tagName === "hr" || element.tagName === "input";
};

/**
 * Collects every element inside a `<pre>` or `<code>`.
 *
 * Whitespace is significant there. Syntax highlighters emit indentation and inter-token spacing
 * as whitespace-only `<span>`s, which measure as zero-length text and would otherwise be dropped
 * as empty wrappers — silently turning `let obj: any` into `letobj: any`.
 */
const collectPreformattedElements = (tree: Hast): Set<Element> => {
	const protectedElements = new Set<Element>();

	const markSubtree = (node: Hast): void => {
		if (!("children" in node)) {
			return;
		}
		for (const child of node.children) {
			if (isElement(child)) {
				protectedElements.add(child);
				markSubtree(child);
			}
		}
	};

	walk(tree, (node) => {
		if (isElement(node) && (node.tagName === "pre" || node.tagName === "code")) {
			protectedElements.add(node);
			markSubtree(node);
			return false;
		}
	});

	return protectedElements;
};

/**
 * Drops elements that would render as nothing.
 *
 * Empty wrappers are extremely common in component markup and each one becomes a stray blank
 * line in the Markdown output. Preformatted regions are exempt, because there an "empty" element
 * is usually meaningful whitespace.
 */
export const dropEmptyElements = (tree: Hast, collector: MetricsCollector): Hast => {
	const preformatted = collectPreformattedElements(tree);

	const visit = (parent: Parent): void => {
		for (let index = 0; index < parent.children.length; index++) {
			const child = parent.children[index];
			if (!isElement(child)) {
				continue;
			}
			if (preformatted.has(child) || !DROP_WHEN_EMPTY_TAGS.has(child.tagName)) {
				visit(child);
				continue;
			}
			if (collector.metrics(child).text > 0 || hasEmbeddedDescendant(child)) {
				visit(child);
				continue;
			}

			// An "empty" element that still holds whitespace is a separator, not a wrapper:
			// highlighters put the space between tokens in `<span class="w"> </span>`, and
			// deleting it glues the surrounding words together. It becomes a space instead.
			if (holdsWhitespace(child)) {
				parent.children[index] = { type: "text", value: " " };
				continue;
			}

			parent.children.splice(index, 1);
			index -= 1;
		}
	};

	if ("children" in tree) {
		visit(tree as Parent);
	}
	return tree;
};

/** True when the subtree contains any whitespace character in its raw text. */
const holdsWhitespace = (element: Element): boolean => {
	for (const child of element.children) {
		if (child.type === "text" && /\s/.test(child.value)) {
			return true;
		}
		if (isElement(child) && holdsWhitespace(child)) {
			return true;
		}
	}
	return false;
};

const hasEmbeddedDescendant = (element: Element): boolean => {
	for (const child of element.children) {
		if (!isElement(child)) {
			continue;
		}
		if (isEmbeddedContent(child) || hasEmbeddedDescendant(child)) {
			return true;
		}
	}
	return false;
};

/**
 * Headings that introduce a list of references the reader is meant to keep.
 *
 * "See also", "References" and their relatives are article conventions — MDN, Wikipedia and most
 * documentation use them for curated further reading. The lists under them are pure links, which
 * is exactly the shape the navigation filter removes, so they need an explicit exemption. The
 * vocabulary is deliberately short and specific; generic section names like "Resources" are
 * excluded because footer sitemaps use the same word.
 */
const REFERENCE_HEADING =
	/^(see also|references?|further reading|external links?|bibliography|sources|footnotes|citations|関連項目|参考文献|外部リンク|脚注|出典|参考リンク|参考資料)$/i;

/** Longest heading the dangling-heading rule will remove alongside its list. */
const MAX_DANGLING_HEADING_LENGTH = 60;

const isHeadingTag = (element: Element): boolean => /^h[1-6]$/.test(element.tagName);

/** Nearest preceding element sibling, skipping whitespace-only text nodes. */
const previousElement = (siblings: Parent["children"], index: number): Element | undefined => {
	for (let cursor = index - 1; cursor >= 0; cursor--) {
		const sibling = siblings[cursor];
		if (isElement(sibling)) {
			return sibling;
		}
		if (sibling.type === "text" && sibling.value.trim().length > 0) {
			return undefined;
		}
	}
	return undefined;
};

/**
 * Decides a link-only block's fate, and its heading's.
 *
 * A pure-link list is content, not navigation, in two specific shapes: when prose introduces it
 * with a colon ("…including:"), and when it sits under a curated reference heading ("See also",
 * "参考文献"). Both are lists the author wrote. Anything else is removed, along with a short
 * heading whose only content was the list — the "### Resources" noise footers leave behind.
 */
const condemnLinkBlock = (
	block: Element,
	siblings: Parent["children"],
	index: number,
	collector: MetricsCollector,
	doomed: Element[],
): void => {
	const heading = previousElement(siblings, index);
	const isHeading = heading !== undefined && isHeadingTag(heading);

	if (isHeading && REFERENCE_HEADING.test(elementText(heading).trim())) {
		return;
	}
	if (introducedByColon(siblings, index, collector)) {
		return;
	}

	doomed.push(block);

	if (isHeading && elementText(heading).trim().length <= MAX_DANGLING_HEADING_LENGTH) {
		doomed.push(heading);
	}
};

/** True when the text leading into this position ends with a colon, i.e. introduces a list. */
const introducedByColon = (siblings: Parent["children"], index: number, collector: MetricsCollector): boolean => {
	const before = previousElement(siblings, index);
	if (!before || collector.metrics(before).text === 0) {
		return false;
	}
	return /[:：]\s*$/.test(elementText(before).trim());
};

/**
 * Finds the widgets {@link cleanContent} would remove, without touching the tree.
 *
 * Separated from the removal itself so callers can price the pass first. Cloning the selected
 * content just to keep a fallback copy costs more than the entire rest of extraction.
 */
export const findCleanupTargets = (tree: Hast, collector: MetricsCollector): Element[] => {
	const doomed: Element[] = [];

	const visit = (node: Hast): void => {
		if (!("children" in node)) {
			return;
		}
		const siblings = (node as Parent).children;

		for (let index = 0; index < siblings.length; index++) {
			const child = siblings[index];
			if (!isElement(child)) {
				continue;
			}
			if (child.tagName === "article" || child.tagName === "main") {
				visit(child);
				continue;
			}

			if (isLinkOnlyBlock(child, collector)) {
				condemnLinkBlock(child, siblings, index, collector, doomed);
				continue;
			}

			if (isMidArticleWidget(child)) {
				doomed.push(child);
				continue; // its subtree goes with it
			}
			visit(child);
		}
	};

	visit(tree);
	return doomed;
};

/** Tags a link-only block may have. `div`/`p` cover the nav rows built without list markup. */
const LINK_BLOCK_TAGS = new Set(["ul", "ol", "nav", "div", "p"]);

/** A navigation strip has several destinations; a byline or lone link does not. */
const MIN_LINK_BLOCK_ANCHORS = 3;

/**
 * True for a block whose text is entirely links, with none of prose's punctuation.
 *
 * Covers `div`s and `p`s as well as list markup: header link rows ("Docs Blog Showcase…") are
 * routinely plain divs of anchors, and the list-only version of this rule left them in place.
 * The anchor-count floor keeps bylines and single links out of scope — no length floor, because
 * short navigation ("Home About Contact") is exactly what must go — and the caller's
 * colon/reference-heading exemptions apply before anything is removed.
 */
const isLinkOnlyBlock = (element: Element, collector: MetricsCollector): boolean => {
	if (!LINK_BLOCK_TAGS.has(element.tagName)) {
		return false;
	}

	const metrics = collector.metrics(element);
	if (metrics.text === 0 || metrics.commas > 0) {
		return false;
	}
	if (metrics.link / metrics.text <= 0.9) {
		return false;
	}

	return countAnchors(element) >= MIN_LINK_BLOCK_ANCHORS;
};

/** Anchor count, stopping as soon as the threshold is settled. */
const countAnchors = (element: Element): number => {
	let count = 0;
	const stack: Hast[] = [element];
	while (stack.length > 0 && count < MIN_LINK_BLOCK_ANCHORS) {
		// biome-ignore lint/style/noNonNullAssertion: guarded by the loop condition
		const node = stack.pop()!;
		if (isElement(node) && node.tagName === "a") {
			count += 1;
		}
		if ("children" in node) {
			for (const child of node.children) {
				stack.push(child as Hast);
			}
		}
	}
	return count;
};

/**
 * True for the furniture publishers embed inside an article body.
 *
 * The container is already known to be content at this point, so these rules can be stricter
 * than the ones applied before candidate selection.
 */
/**
 * Elements whose text is quoted literally — a docs page writing `<code>--copy</code>` or
 * `<kbd>Close</kbd>` documents a flag or a key, it is not the control itself.
 */
const LITERAL_TEXT_TAGS = new Set(["code", "kbd", "samp", "var", "pre"]);

const isMidArticleWidget = (element: Element): boolean => {
	if (LITERAL_TEXT_TAGS.has(element.tagName)) {
		return false;
	}
	if (element.tagName === "form" || element.tagName === "fieldset") {
		return true;
	}

	// A button renders as its label text, and the label is always an instruction to a browser —
	// "Copy", "Yes", "Show more". No article stores content in one.
	if (element.tagName === "button") {
		return true;
	}

	// Class names are unusable on sites that hash them, so fall back to what the element says.
	// Only whole-element matches count, and only below a length cap, so prose is never touched.
	return isUiChromeText(elementText(element));
};

/**
 * Final clean-up inside the selected article container.
 *
 * Removes share bars, related-post rails and comment forms, then drops the empty wrappers that
 * component markup leaves behind.
 */
export const cleanContent = (tree: Hast, collector: MetricsCollector): Hast => {
	const doomed = new Set(findCleanupTargets(tree, collector));

	if (doomed.size > 0) {
		pruneInPlace(tree, (node) => !(isElement(node) && doomed.has(node)));
	}

	return dropEmptyElements(tree, new MetricsCollectorCtor());
};

/** Complete text content of an element, used for phrase matching. */
const elementText = (node: Hast): string => {
	if (node.type === "text") {
		return node.value;
	}
	if (!("children" in node)) {
		return "";
	}
	let text = "";
	for (const child of node.children) {
		text += elementText(child as Hast);
	}
	return text;
};
