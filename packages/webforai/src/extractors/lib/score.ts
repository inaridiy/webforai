/**
 * Candidate scoring for the main-content extractor.
 *
 * The core of the algorithm follows @mozilla/readability (Apache-2.0, original copyright
 * (c) 2010 Arc90 Inc): score every paragraph-like node by how much prose it holds, propagate
 * that score to its ancestors with decreasing weight, then pick the best-scoring container.
 *
 * Three signals are layered on top of the classic algorithm:
 *
 * - **Semantic markup.** `<article>`, `<main>`, `role="main"` and schema.org `articleBody` are
 *   near-conclusive on modern sites, and pre-date nothing in the 2010 heuristics.
 * - **Rendered geometry.** When a loader annotated the DOM with `data-rwidth`/`data-rheight`,
 *   the real layout tells us what the reader actually saw. Zero-height containers are collapsed
 *   menus regardless of how much text they hold.
 * - **CJK-aware length.** Character counts mean different things per script, so length-derived
 *   bonuses are normalised by the language's information density.
 */

import type { Element, Nodes as Hast, Parent } from "hast";

import {
	type MetricsCollector,
	classList,
	isElement,
	matchString,
	numericProperty,
	stringProperty,
	walk,
} from "../../utils/hast-fast";
import { CANDIDATE_TAGS, CONTENT_ROLES, REGEXPS, SCOREABLE_TAGS, minContentLength } from "./constants";

/** Base score by container tag, mirroring Readability's `initializeNode`. */
const TAG_BASE_SCORE: Record<string, number> = {
	div: 5,
	pre: 3,
	td: 3,
	blockquote: 3,
	article: 10,
	main: 10,
	section: 5,
	address: -3,
	ol: -3,
	ul: -3,
	dl: -3,
	dd: -3,
	dt: -3,
	li: -3,
	form: -3,
	h1: -5,
	h2: -5,
	h3: -5,
	h4: -5,
	h5: -5,
	h6: -5,
	th: -5,
};

/** Ancestor levels that receive propagated score. */
const MAX_ANCESTOR_DEPTH = 5;

/** A paragraph shorter than this is noise rather than prose. */
const MIN_SCOREABLE_TEXT = 25;

export interface ScoredCandidate {
	element: Element;
	score: number;
}

export interface ScoringContext {
	collector: MetricsCollector;
	parents: WeakMap<Hast, Parent>;
	lang?: string;
	/** True when the document carries rendered-geometry annotations. */
	hasGeometry: boolean;
	/** Paragraph-like elements, collected during the same traversal that built `parents`. */
	scoreable: Element[];
}

/**
 * Builds parent links, which HAST does not carry, and collects the scoreable nodes.
 *
 * Parent discovery, geometry detection and candidate collection all need the same full
 * traversal, so they share one — extraction is a fifth of total conversion time and each
 * additional walk over a megabyte-scale document is measurable.
 */
export const buildScoringContext = (root: Hast, collector: MetricsCollector, lang?: string): ScoringContext => {
	const parents = new WeakMap<Hast, Parent>();
	const scoreable: Element[] = [];
	let hasGeometry = false;

	walk(root, (node, parent) => {
		if (parent) {
			parents.set(node, parent);
		}
		if (!isElement(node)) {
			return;
		}
		if (!hasGeometry && numericProperty(node, "data-rheight") !== undefined) {
			hasGeometry = true;
		}
		if (isParagraphLike(node)) {
			scoreable.push(node);
		}
	});

	return { collector, parents, lang, hasGeometry, scoreable };
};

/**
 * Class/id based weight.
 *
 * Deliberately capped: on component-framework sites the class attribute is often a hashed
 * string that matches a regex by accident, so this must nudge rather than decide.
 */
export const classWeight = (element: Element): number => {
	let weight = 0;
	const id = stringProperty(element, "id") ?? "";
	const classes = classList(element).join(" ");

	if (REGEXPS.negative.test(classes)) {
		weight -= 25;
	}
	if (REGEXPS.positive.test(classes)) {
		weight += 25;
	}
	if (REGEXPS.negative.test(id)) {
		weight -= 25;
	}
	if (REGEXPS.positive.test(id)) {
		weight += 25;
	}

	return weight;
};

/** Strong, near-conclusive markers that an element *is* the article container. */
export const semanticBonus = (element: Element): number => {
	let bonus = 0;

	if (element.tagName === "article") {
		bonus += 60;
	}
	if (element.tagName === "main") {
		bonus += 50;
	}

	const role = stringProperty(element, "role");
	if (role && CONTENT_ROLES.has(role)) {
		bonus += 40;
	}

	const itemprop = stringProperty(element, "itemprop");
	if (itemprop?.includes("articleBody")) {
		bonus += 80;
	}

	// Common on documentation frameworks (Docusaurus, VitePress, Nextra, mdBook).
	const match = matchString(element);
	if (
		/(^|[\s_-])(markdown|prose|article-?content|post-?content|entry-?content|doc-?content|md-?content)([\s_-]|$)/i.test(
			match,
		)
	) {
		bonus += 35;
	}

	return bonus;
};

/**
 * Multiplier derived from the element's rendered box.
 *
 * Only applied when a loader supplied geometry. A container the browser laid out at zero height
 * was never visible, and one that is very narrow is a rail rather than the article column.
 */
export const geometryMultiplier = (element: Element, context: ScoringContext): number => {
	if (!context.hasGeometry) {
		return 1;
	}

	const height = numericProperty(element, "data-rheight");
	const width = numericProperty(element, "data-rwidth");

	if (height === undefined || width === undefined) {
		return 1;
	}
	// Collapsed menus, offscreen drawers and print-only blocks.
	if (height === 0 || width === 0) {
		return 0;
	}
	// Sidebars and rails: tall but far too narrow to be the reading column.
	if (width < 220) {
		return 0.35;
	}

	return 1;
};

/** Score contributed by one paragraph-like node. */
const paragraphScore = (textLength: number, commas: number, densityDivisor: number): number =>
	1 + commas + Math.min(Math.floor(textLength / densityDivisor), 3);

const ancestorWeight = (level: number): number => {
	if (level === 0) {
		return 1;
	}
	if (level === 1) {
		return 2;
	}
	return level * 3;
};

/**
 * Elements worth scoring: real paragraphs, plus `div`s that behave like paragraphs.
 *
 * A `div` whose children are all inline is a paragraph in disguise — extremely common in
 * component-rendered markup — while a `div` full of block children is a layout container and
 * gets its score from its descendants instead.
 */
const isParagraphLike = (element: Element): boolean => {
	if (!SCOREABLE_TAGS.has(element.tagName)) {
		return false;
	}
	if (element.tagName !== "div" && element.tagName !== "section") {
		return true;
	}
	return !element.children.some((child) => isElement(child) && CANDIDATE_TAGS.has(child.tagName));
};

/**
 * Scores every candidate container in the document.
 *
 * Returns candidates sorted best-first. An empty result means no container looked like prose,
 * and callers should fall back to the whole document.
 */
export const scoreCandidates = (_root: Hast, context: ScoringContext): ScoredCandidate[] => {
	const { collector, parents } = context;
	const scores = new Map<Element, number>();
	// CJK text conveys more per character, so the length bonus saturates sooner.
	const densityDivisor = minContentLength(context.lang) / 4;

	for (const node of context.scoreable) {
		const metrics = collector.metrics(node);
		if (metrics.text < MIN_SCOREABLE_TEXT) {
			continue;
		}

		const contribution = paragraphScore(metrics.text, metrics.commas, densityDivisor);

		let current: Hast | undefined = node;
		for (let level = 0; level < MAX_ANCESTOR_DEPTH && current; level++) {
			const parent: Parent | undefined = parents.get(current);
			if (!(parent && isElement(parent))) {
				break;
			}
			if (CANDIDATE_TAGS.has(parent.tagName) || parent.tagName === "article" || parent.tagName === "main") {
				const base =
					scores.get(parent) ?? (TAG_BASE_SCORE[parent.tagName] ?? 0) + classWeight(parent) + semanticBonus(parent);
				scores.set(parent, base + contribution / ancestorWeight(level));
			}
			current = parent;
		}
	}

	const candidates: ScoredCandidate[] = [];
	for (const [element, rawScore] of scores) {
		// Link-heavy containers are navigation, however much text they hold.
		const density = collector.linkDensity(element);
		const score = rawScore * (1 - density) * geometryMultiplier(element, context);
		if (score > 0) {
			candidates.push({ element, score });
		}
	}

	candidates.sort((a, b) => b.score - a.score);
	return candidates;
};

/**
 * Expands the winning candidate to include sibling blocks that belong to the same article.
 *
 * Publishers routinely split a post across sibling `<div>`s (lead paragraph, body, pull quote),
 * so returning only the top-scoring node truncates the article. A sibling joins when it scores
 * comparably, or when it is a substantial low-link paragraph.
 */
export const collectArticleNodes = (
	top: ScoredCandidate,
	candidates: ScoredCandidate[],
	context: ScoringContext,
): Element[] => {
	const { collector, parents } = context;
	const parent = parents.get(top.element);

	if (!(parent && isElement(parent))) {
		return [top.element];
	}

	const scoreOf = new Map(candidates.map((candidate) => [candidate.element, candidate.score]));
	const threshold = Math.max(10, top.score * 0.2);
	const selected: Element[] = [];

	for (const child of parent.children) {
		if (!isElement(child)) {
			continue;
		}
		if (child === top.element) {
			selected.push(child);
			continue;
		}

		const siblingScore = scoreOf.get(child) ?? 0;
		if (siblingScore >= threshold) {
			selected.push(child);
			continue;
		}

		if (child.tagName === "p" || child.tagName === "section") {
			const metrics = collector.metrics(child);
			const density = collector.linkDensity(child);
			if (metrics.text > 80 && density < 0.25) {
				selected.push(child);
			}
		}
	}

	return selected.length > 0 ? selected : [top.element];
};

/** How many ancestor levels the boundary climb may traverse. */
const MAX_CLIMB_HOPS = 5;

/** A parent must add at least this fraction of the current text to justify a climb. */
const MIN_CLIMB_RELATIVE_GAIN = 0.08;

/** ...and at least this many characters, so tiny documents do not climb on noise. */
const MIN_CLIMB_ABSOLUTE_GAIN = 500;

/** The added text must be prose: at most this fraction of it may be link text. */
const MAX_CLIMB_GAIN_LINK_DENSITY = 1 / 3;

/** A parent must have scored at least this fraction of the winner to be climbable. */
const CLIMB_SCORE_FLOOR = 1 / 3;

/**
 * Promotes the winning candidate to an ancestor when the ancestor is the real article boundary.
 *
 * Score propagation concentrates in the densest section of a long document, so on reference
 * pages the winner is routinely one *section* — PostgreSQL's SELECT page scored its "Parameters"
 * section above the `refentry` that also holds the title, synopsis and description, and the
 * output opened mid-document. Readability climbs from its top candidate for the same reason.
 *
 * A hop is taken only when the parent adds a substantial amount of low-link text and itself
 * scored within a factor of the winner; the first parent that fails either test ends the climb.
 * Wrapper parents that add nothing fail the gain test, which is what keeps the climb from
 * drifting up into page chrome one harmless-looking level at a time.
 */
export const climbToArticleBoundary = (
	top: ScoredCandidate,
	candidates: ScoredCandidate[],
	context: ScoringContext,
): Element => {
	const { collector, parents } = context;
	const scoreOf = new Map(candidates.map((candidate) => [candidate.element, candidate.score]));
	const scoreFloor = top.score * CLIMB_SCORE_FLOOR;

	let current = top.element;

	for (let hop = 0; hop < MAX_CLIMB_HOPS; hop++) {
		const parent = parents.get(current);
		if (!(parent && isElement(parent))) {
			break;
		}

		const parentScore = scoreOf.get(parent);
		if (parentScore === undefined || parentScore < scoreFloor) {
			break;
		}

		const currentMetrics = collector.metrics(current);
		const parentMetrics = collector.metrics(parent);
		const gainedText = parentMetrics.text - currentMetrics.text;

		if (gainedText < Math.max(MIN_CLIMB_ABSOLUTE_GAIN, currentMetrics.text * MIN_CLIMB_RELATIVE_GAIN)) {
			break;
		}

		const gainedLink = parentMetrics.link - currentMetrics.link;
		if (gainedLink / gainedText > MAX_CLIMB_GAIN_LINK_DENSITY) {
			break;
		}

		current = parent;
	}

	return current;
};
