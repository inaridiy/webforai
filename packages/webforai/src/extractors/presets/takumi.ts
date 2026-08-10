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
	const doomed = findUnlikelyElements(searchRoot);
	const doomedText = doomed.reduce((sum, element) => sum + collector.metrics(element).text, 0);

	if (searchText - doomedText > Math.max(minLength, searchText * MIN_RETAINED_FRACTION)) {
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
