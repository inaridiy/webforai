/**
 * The main-content extractor.
 *
 * "takumi" is written 匠 in Japanese and refers to a highly skilled artisan.
 *
 * The pipeline is:
 *
 *   1. scope to `<body>` and clone, so the caller's tree is never mutated
 *   2. strip nodes that can never be content (metadata, comments, invisible elements)
 *   3. take the semantic shortcut when the page states where its content is
 *   4. strip likely furniture, reverting if that cut too deep
 *   5. score candidate containers and pick the best, plus its qualifying siblings
 *   6. clean widgets out of the winner and drop empty wrappers
 *
 * Every narrowing step is guarded: if a step leaves less text than its input can justify, the
 * extractor keeps the wider tree. Losing the article is far worse than keeping some boilerplate.
 */

import type { Element, Nodes as Hast } from "hast";

import {
	MetricsCollector,
	cloneHast,
	findElement,
	isElement,
	pruneInPlace,
	stringProperty,
} from "../../utils/hast-fast";
import { minContentLength } from "../lib/constants";
import { cleanContent, findCleanupTargets, findUnlikelyElements, stripNonContent } from "../lib/sanitize";
import { buildScoringContext, climbToArticleBoundary, collectArticleNodes, scoreCandidates } from "../lib/score";
import { truncateTrailingBoilerplate } from "../lib/terminators";
import type { ExtractParams } from "../types";

/** Fraction of the parent tree's text a narrowed selection must retain to be trusted. */
const MIN_RETAINED_FRACTION = 0.25;

/** Link density above which a weakly-matched block is furniture even when it is large. */
const FURNITURE_LINK_DENSITY = 0.5;

/** Attribute-driven markers that state, unambiguously, where the content is. */
const SEMANTIC_SELECTORS: Array<(element: Element) => boolean> = [
	(element) => stringProperty(element, "itemprop")?.includes("articleBody") ?? false,
	(element) => element.tagName === "article",
	(element) => element.tagName === "main",
	(element) => stringProperty(element, "role") === "main",
];

const findBody = (hast: Hast): Hast => findElement(hast, (element) => element.tagName === "body") ?? hast;

/**
 * Returns the semantic container when the page marks one and it holds enough prose.
 *
 * Skipped when several equally-marked candidates exist (index pages list many `<article>`
 * elements), because in that case the markup says "these are entries", not "this is the body".
 */
const semanticShortcut = (tree: Hast, collector: MetricsCollector, minLength: number): Element | undefined => {
	for (const matches of SEMANTIC_SELECTORS) {
		const found: Element[] = [];
		collectMatching(tree, matches, found);

		if (found.length !== 1) {
			continue;
		}

		const candidate = found[0];
		const metrics = collector.metrics(candidate);
		if (metrics.text >= minLength && collector.linkDensity(candidate) < 0.5) {
			return candidate;
		}
	}

	return undefined;
};

/** Collects matches but stops early once ambiguity is established. */
const collectMatching = (tree: Hast, matches: (element: Element) => boolean, into: Element[]): void => {
	const stack: Hast[] = [tree];
	while (stack.length > 0 && into.length < 2) {
		// biome-ignore lint/style/noNonNullAssertion: guarded by the loop condition
		const node = stack.pop()!;
		if (isElement(node) && matches(node)) {
			into.push(node);
			continue;
		}
		if ("children" in node) {
			for (const child of node.children) {
				stack.push(child as Hast);
			}
		}
	}
};

const containsTag = (element: Element, tagName: string): boolean =>
	element.children.some((child) => isElement(child) && (child.tagName === tagName || containsTag(child, tagName)));

/** True when the document has an `<h1>` and every one of them lies inside a doomed element. */
const removesEveryTitle = (root: Hast, doomed: Element[]): boolean => {
	if (!doomed.some((element) => containsTag(element, "h1"))) {
		return false;
	}
	const doomedSet = new Set(doomed);
	let survivor = false;
	const visit = (node: Hast): void => {
		if (survivor || !("children" in node)) {
			return;
		}
		for (const child of node.children) {
			if (!isElement(child) || doomedSet.has(child)) {
				continue;
			}
			if (child.tagName === "h1") {
				survivor = true;
				return;
			}
			visit(child);
		}
	};
	visit(root);
	return !survivor;
};

const asRootOf = (nodes: Element[]): Hast => ({ type: "root", children: nodes });

/**
 * Picks the content container using candidate scoring.
 *
 * Returns `undefined` when nothing scored, which means the page has no prose-shaped container
 * and the caller should keep the whole document.
 */
const scoredSelection = (tree: Hast, collector: MetricsCollector, lang: string | undefined): Hast | undefined => {
	const context = buildScoringContext(tree, collector, lang);
	const candidates = scoreCandidates(tree, context);

	const top = candidates[0];
	if (!top) {
		return undefined;
	}

	// Score concentrates in the densest section of a long document, so on reference pages the
	// winner can be one section of the article rather than the article. Climb to the real
	// boundary first; sibling collection then runs at the promoted level.
	const promoted = climbToArticleBoundary(top, candidates, context);
	const anchor = promoted === top.element ? top : { element: promoted, score: top.score };

	const selected = collectArticleNodes(anchor, candidates, context);
	return selected.length === 1 ? selected[0] : asRootOf(selected);
};

/**
 * Extracts the main content of a document.
 *
 * @param params - {@link ExtractParams}
 * @returns The HAST tree containing only the article content.
 */
export const takumiExtractor = (params: ExtractParams): Hast => {
	const { hast, lang, owned } = params;

	// `owned` means the caller parsed the HTML for us and nobody else holds a reference, so the
	// tree can be mutated directly. Cloning a megabyte-scale document is the single most
	// expensive operation in the pipeline, and skipping it is safe exactly in that case.
	const body = owned ? findBody(hast) : cloneHast(findBody(hast));
	stripNonContent(body);

	let collector = new MetricsCollector();
	const baseText = collector.textLength(body);
	if (baseText === 0) {
		return body;
	}

	// A short page cannot clear the language's nominal threshold, so scale it down rather than
	// rejecting every candidate and falling back to the raw document.
	const minLength = Math.min(minContentLength(lang), Math.max(0, baseText - 200));

	const shortcut = semanticShortcut(body, collector, minLength);
	const searchRoot: Hast = shortcut ?? body;

	// Price the furniture-removal pass before paying for it: summing the text of the elements it
	// would delete is far cheaper than cloning the tree, pruning the copy and re-measuring.
	const searchText = collector.textLength(searchRoot);
	let doomed = findUnlikelyElements(searchRoot);
	const textOf = (elements: Element[]) => elements.reduce((sum, element) => sum + collector.metrics(element).text, 0);

	let acceptable = searchText - textOf(doomed) > Math.max(minLength, searchText * MIN_RETAINED_FRACTION);
	if (!acceptable) {
		// The full pass would cut too deep, usually because a class-substring match hit a wrapper
		// that holds the article. Rather than giving up on furniture removal altogether — which
		// leaves every carousel and footer in place on exactly the pages that have the most —
		// retry sparing the weak matches that read as prose. Link-dense weak matches are rails,
		// carousels and sitemaps whatever their size, so only the absolute floor guards them.
		doomed = findUnlikelyElements(searchRoot, (element) => collector.linkDensity(element) < FURNITURE_LINK_DENSITY);
		// A retry that would take every `<h1>` with it has condemned the page itself — a reading
		// list, changelog or index is link-dense too — so it is abandoned like the full pass.
		acceptable =
			doomed.length > 0 && searchText - textOf(doomed) >= minLength && !removesEveryTitle(searchRoot, doomed);
	}

	if (acceptable) {
		const doomedSet = new Set<Element>(doomed);
		pruneInPlace(searchRoot, (node) => !(isElement(node) && doomedSet.has(node)));
		collector = new MetricsCollector();
	}

	const scoringRoot = searchRoot;
	const scoringRootText = collector.textLength(scoringRoot);
	const selection = shortcut ? scoringRoot : scoredSelection(scoringRoot, collector, lang) ?? scoringRoot;

	// The selection is a live subtree of `scoringRoot`; cleaning mutates it, so measure first.
	const selectionText = collector.textLength(selection);

	const selectionIsSound = selectionText >= minLength || selectionText > scoringRootText * MIN_RETAINED_FRACTION;
	const chosen = selectionIsSound ? selection : scoringRoot;

	// Trailing boilerplate goes first, while its markers still exist: the widget cleanup below
	// would remove the "Related articles" heading itself and leave whatever followed it behind.
	truncateTrailingBoilerplate(chosen);

	// Final guard: cleaning must not gut the article either.
	//
	// The check has to happen *before* the removal, because `cleanContent` prunes in place and
	// hands back the same tree — comparing after the fact would leave the fallback with nothing
	// but the tree it had just rejected. Pricing the pass beforehand also avoids a clone, which
	// on large pages costs more than every other extraction step combined.
	const cleanupCollector = new MetricsCollector();
	// Measured against `chosen`, not `selection`: the two differ whenever the selection was
	// rejected above, and subtracting one tree's widgets from another tree's total is meaningless.
	const chosenText = cleanupCollector.textLength(chosen);
	const widgets = findCleanupTargets(chosen, cleanupCollector);
	const widgetText = widgets.reduce((sum, element) => sum + cleanupCollector.metrics(element).text, 0);
	const remainingText = chosenText - widgetText;

	if (remainingText < chosenText * MIN_RETAINED_FRACTION && remainingText < minLength) {
		return chosen;
	}

	return cleanContent(chosen, cleanupCollector);
};
