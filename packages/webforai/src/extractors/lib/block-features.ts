/**
 * Per-block features for the learned main-content model.
 *
 * Everything here is cheap and local: text statistics of the block and its neighbours (the
 * shallow features of Kohlschütter et al., WSDM 2010), the structure around it, and the
 * hand-written heuristics of the rest of the extractor turned into evidence rather than
 * decisions — class-name patterns, the furniture tiers and candidate scores. Computing them does
 * not modify the tree.
 */

import type { Element, Nodes as Hast, Parent } from "hast";

import { type MetricsCollector, classList, matchString, stringProperty } from "../../utils/hast-fast";
import { type BlockFrame, type TextBlock, ancestorAt } from "./blocks";
import { CONTENT_ROLES, REGEXPS, UNLIKELY_ROLES } from "./constants";
import { findLandmarkChrome, unlikelyTier } from "./sanitize";
import { buildScoringContext, scoreCandidates } from "./score";

/** Feature names, in vector order. The generated model refers to features by position. */
export const FEATURE_NAMES = [
	"bias",
	"logLen",
	"linkDensity",
	"logLinks",
	"hasImage",
	"textless",
	"punctDensity",
	"digitRatio",
	"sentenceEnds",
	"tag_p",
	"tag_li",
	"tag_cell",
	"tag_h1",
	"tag_h2_6",
	"tag_pre",
	"tag_div",
	"tag_dtdd",
	"tag_blockquote",
	"tag_figcaption",
	"in_nav",
	"in_header",
	"in_footer",
	"in_aside",
	"in_article",
	"in_main",
	"in_form",
	"in_table",
	"in_list",
	"role_chrome",
	"role_content",
	"cls_unlikely",
	"cls_positive",
	"cls_negative",
	"cls_strong",
	"cls_special",
	"cls_byline",
	"cls_comment",
	"landmark",
	"doom_strong",
	"doom_weak",
	"depth",
	"relPos",
	"relCharPos",
	"prev_logLen",
	"prev_linkDensity",
	"next_logLen",
	"next_linkDensity",
	"win_linkDensity",
	"win_logLen",
	"parent_linkDensity",
	"parent_logText",
	"gparent_linkDensity",
	"gparent_logText",
	"inTopCandidate",
	"candidateScore",
	"inTopSibling",
	"takumi_kept",
] as const;

export const FEATURE_COUNT = FEATURE_NAMES.length;

const PUNCT = new Set([...".,;:!?、。，．！？；："]);
const SENTENCE_END = new Set([...".!?。！？"]);

/** Punctuation, digits and sentence ends, counted in one pass without allocating. */
const textStats = (text: string): { punct: number; digits: number; sentences: number } => {
	let punct = 0;
	let digits = 0;
	let sentences = 0;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		const code = text.charCodeAt(index);
		if (code >= 48 && code <= 57) {
			digits += 1;
		} else if (PUNCT.has(char)) {
			punct += 1;
			const next = text.charCodeAt(index + 1);
			if (SENTENCE_END.has(char) && (Number.isNaN(next) || next === 32 || next === 10 || code > 0x3000)) {
				sentences += 1;
			}
		}
	}
	return { punct, digits, sentences };
};
const COMMENT = /comment|disqus|reply|respond/i;

const log1p = (value: number) => Math.log(1 + value);

interface ElementSignals {
	unlikely: boolean;
	positive: boolean;
	negative: boolean;
	strong: boolean;
	special: boolean;
	byline: boolean;
	comment: boolean;
	roleChrome: boolean;
	roleContent: boolean;
}

const signalsOf = (element: Element, cache: WeakMap<Element, ElementSignals>): ElementSignals => {
	let signals = cache.get(element);
	if (signals) {
		return signals;
	}
	const match = matchString(element);
	const role = stringProperty(element, "role") ?? "";
	const names = [...classList(element), stringProperty(element, "id") ?? ""];
	signals = {
		unlikely: REGEXPS.unlikelyCandidates.test(match) && !REGEXPS.okMaybeItsaCandidate.test(match),
		positive: REGEXPS.positive.test(match),
		negative: REGEXPS.negative.test(match),
		strong: names.some((name) => REGEXPS.stronglyUnlikely.test(name)),
		special: REGEXPS.specialUnlikelyCandidates.test(match),
		byline: REGEXPS.byline.test(match),
		comment: COMMENT.test(match),
		roleChrome: UNLIKELY_ROLES.has(role),
		roleContent: CONTENT_ROLES.has(role),
	};
	cache.set(element, signals);
	return signals;
};

/** How far up the ancestor chain class/role evidence is collected, nearest weighted most. */
const SIGNAL_LEVELS = 6;

const SIGNAL_COUNT = 9;

interface Chain {
	inNav: number;
	inHeader: number;
	inFooter: number;
	inAside: number;
	inArticle: number;
	inMain: number;
	inForm: number;
	inTable: number;
	inList: number;
	landmark: number;
	doomStrong: number;
	doomWeak: number;
	inTop: number;
	inTopSibling: number;
	/** Candidate score of the nearest scored ancestor, relative to the winner. */
	nearestScore: number;
	/** Per class/role signal, distance to the nearest ancestor carrying it. */
	distance: number[];
}

export interface BlockFeatureInput {
	/** The tree the blocks came from (after invisible content was removed). */
	root: Hast;
	blocks: TextBlock[];
	collector: MetricsCollector;
	lang?: string;
	/** Elements the heuristic extractor keeps (see `takumiSelection`). */
	takumiKept?: Set<Element>;
}

/** Sequential writer for one feature row. */
class RowWriter {
	offset = 0;
	constructor(readonly out: Float32Array) {}
	push(value: number): void {
		this.out[this.offset++] = value;
	}
	flag(condition: boolean | number | undefined): void {
		this.out[this.offset++] = condition ? 1 : 0;
	}
}

const EMPTY_CHAIN: Chain = {
	inNav: 0,
	inHeader: 0,
	inFooter: 0,
	inAside: 0,
	inArticle: 0,
	inMain: 0,
	inForm: 0,
	inTable: 0,
	inList: 0,
	landmark: 0,
	doomStrong: 0,
	doomWeak: 0,
	inTop: 0,
	inTopSibling: 0,
	nearestScore: 0,
	distance: new Array(SIGNAL_COUNT).fill(Number.POSITIVE_INFINITY),
};

const signalFlags = (signals: ElementSignals): boolean[] => [
	signals.roleChrome,
	signals.roleContent,
	signals.unlikely,
	signals.positive,
	signals.negative,
	signals.strong,
	signals.special,
	signals.byline,
	signals.comment,
];

const any = (parent: number, condition: boolean): number => (parent || condition ? 1 : 0);

/**
 * Ancestor-derived features. Each obeys a recurrence on the parent's value, so it is computed
 * once per element instead of once per block per ancestor.
 */
class ChainResolver {
	readonly #chains = new Map<Element, Chain>();
	readonly #signals = new WeakMap<Element, ElementSignals>();

	constructor(
		readonly landmarks: Set<Element>,
		readonly candidateScore: WeakMap<Element, number>,
		readonly parents: WeakMap<Hast, Parent>,
		readonly top: Element | undefined,
	) {}

	/** Iterative, so a deeply nested page cannot exhaust the call stack. */
	resolve(frame: BlockFrame | undefined): Chain {
		const pending: BlockFrame[] = [];
		let current = frame;
		let chain = EMPTY_CHAIN;
		while (current) {
			const memo = this.#chains.get(current.element);
			if (memo) {
				chain = memo;
				break;
			}
			pending.push(current);
			current = current.parent;
		}
		for (let index = pending.length - 1; index >= 0; index--) {
			chain = this.#derive(chain, pending[index].element);
			this.#chains.set(pending[index].element, chain);
		}
		return chain;
	}

	#derive(parent: Chain, element: Element): Chain {
		const tag = element.tagName;
		const tier = unlikelyTier(element);
		const flags = signalFlags(signalsOf(element, this.#signals));
		const top = this.top;
		const topParent = top ? this.parents.get(top) : undefined;
		return {
			inNav: any(parent.inNav, tag === "nav"),
			inHeader: any(parent.inHeader, tag === "header"),
			inFooter: any(parent.inFooter, tag === "footer"),
			inAside: any(parent.inAside, tag === "aside"),
			inArticle: any(parent.inArticle, tag === "article"),
			inMain: any(parent.inMain, tag === "main"),
			inForm: any(parent.inForm, tag === "form"),
			inTable: any(parent.inTable, tag === "table"),
			inList: any(parent.inList, tag === "ul" || tag === "ol"),
			landmark: any(parent.landmark, this.landmarks.has(element)),
			doomStrong: any(parent.doomStrong, tier === "strong"),
			doomWeak: any(parent.doomWeak, tier === "weak"),
			inTop: any(parent.inTop, element === top),
			inTopSibling: any(
				parent.inTopSibling,
				topParent !== undefined && element !== top && this.parents.get(element) === topParent,
			),
			nearestScore: this.candidateScore.get(element) ?? parent.nearestScore,
			distance: parent.distance.map((distance, signal) => (flags[signal] ? 0 : distance + 1)),
		};
	}
}

const evidence = (distance: number): number => (distance < SIGNAL_LEVELS ? 1 / (1 + distance) : 0);

const writeText = (row: RowWriter, block: TextBlock, density: number): void => {
	const length = block.text.length;
	const stats = textStats(block.text);
	row.push(1);
	row.push(log1p(length));
	row.push(density);
	row.push(log1p(block.links));
	row.flag(block.images > 0);
	row.flag(length === 0);
	row.push(length === 0 ? 0 : stats.punct / length);
	row.push(length === 0 ? 0 : stats.digits / length);
	row.push(log1p(stats.sentences));
};

const writeTag = (row: RowWriter, tag: string): void => {
	row.flag(tag === "p");
	row.flag(tag === "li");
	row.flag(tag === "td" || tag === "th");
	row.flag(tag === "h1");
	row.flag(/^h[2-6]$/.test(tag));
	row.flag(tag === "pre");
	row.flag(tag === "div" || tag === "section");
	row.flag(tag === "dt" || tag === "dd");
	row.flag(tag === "blockquote");
	row.flag(tag === "figcaption");
};

const writeChain = (row: RowWriter, chain: Chain): void => {
	for (const value of [
		chain.inNav,
		chain.inHeader,
		chain.inFooter,
		chain.inAside,
		chain.inArticle,
		chain.inMain,
		chain.inForm,
		chain.inTable,
		chain.inList,
	]) {
		row.push(value);
	}
	for (const distance of chain.distance) {
		row.push(evidence(distance));
	}
	row.push(chain.landmark);
	row.push(chain.doomStrong);
	row.push(chain.doomWeak);
};

/** Mean link density and log length over the blocks within `radius` of `index`. */
const windowMeans = (textLen: number[], density: number[], index: number, radius: number): [number, number] => {
	let link = 0;
	let len = 0;
	let size = 0;
	for (let near = Math.max(0, index - radius); near <= Math.min(textLen.length - 1, index + radius); near++) {
		link += density[near];
		len += log1p(textLen[near]);
		size += 1;
	}
	return [link / size, len / size];
};

/** Neighbouring blocks' length and link density, and a ±2 window mean of both. */
const writeNeighbourhood = (row: RowWriter, index: number, textLen: number[], density: number[]): void => {
	const hasPrevious = index > 0;
	const hasNext = index < textLen.length - 1;
	row.push(hasPrevious ? log1p(textLen[index - 1]) : 0);
	row.push(hasPrevious ? density[index - 1] : 0);
	row.push(hasNext ? log1p(textLen[index + 1]) : 0);
	row.push(hasNext ? density[index + 1] : 0);
	const [windowLink, windowLen] = windowMeans(textLen, density, index, 2);
	row.push(windowLink);
	row.push(windowLen);
};

/** Link density and text size of the two containers above the block's owner. */
const writeContainers = (row: RowWriter, block: TextBlock, collector: MetricsCollector): void => {
	for (const container of [ancestorAt(block, 1), ancestorAt(block, 2)]) {
		row.push(container ? collector.linkDensity(container) : 0);
		row.push(container ? log1p(collector.textLength(container)) : 0);
	}
};

/**
 * Builds one feature vector per block, row-major in a single `Float32Array`.
 *
 * Cost: one pass over the blocks, ancestor features memoised per element, plus one furniture
 * scan and one candidate-scoring pass over the tree — both of which the heuristic extractor
 * performs anyway.
 */
export const blockFeatures = ({ root, blocks, collector, lang, takumiKept }: BlockFeatureInput): Float32Array => {
	const count = blocks.length;
	const out = new Float32Array(count * FEATURE_COUNT);

	const context = buildScoringContext(root, collector, lang);
	const candidates = scoreCandidates(root, context);
	const topScore = candidates[0]?.score ?? 1;
	const candidateScore = new WeakMap<Element, number>();
	for (const candidate of candidates) {
		candidateScore.set(candidate.element, candidate.score / topScore);
	}
	const chains = new ChainResolver(findLandmarkChrome(root), candidateScore, context.parents, candidates[0]?.element);

	const textLen = blocks.map((block) => block.text.length);
	const density = blocks.map((block) => (block.text.length === 0 ? 0 : block.linkChars / block.text.length));
	const totalChars = textLen.reduce((sum, length) => sum + length, 0) || 1;
	let charsBefore = 0;

	for (let index = 0; index < count; index++) {
		const block = blocks[index];
		const row = new RowWriter(out.subarray(index * FEATURE_COUNT, (index + 1) * FEATURE_COUNT));
		const chain = chains.resolve(block.frame);

		writeText(row, block, density[index]);
		writeTag(row, block.owner.tagName);
		writeChain(row, chain);

		row.push(Math.min(block.frame.depth, 40) / 40);
		row.push(count <= 1 ? 0 : index / (count - 1));
		row.push(charsBefore / totalChars);
		charsBefore += textLen[index];

		writeNeighbourhood(row, index, textLen, density);
		writeContainers(row, block, collector);

		row.push(chain.inTop);
		row.push(chain.nearestScore);
		row.push(chain.inTopSibling);
		row.flag(takumiKept?.has(block.owner));
	}

	return out;
};

/** Second-stage features: the first stage's probabilities, aggregated over context. */
export const STACK_FEATURE_NAMES = [
	"s1_logit",
	"s1_win1",
	"s1_win3",
	"s1_parent",
	"s1_gparent",
	"s1_ggparent",
	"s1_parentShare",
	"s1_distHigh",
	"s1_docShare",
] as const;

export const STACKED_FEATURE_COUNT = FEATURE_COUNT + STACK_FEATURE_NAMES.length;

const logit = (p: number) => Math.log(Math.max(1e-6, p) / Math.max(1e-6, 1 - p));

/** Text-weighted first-stage probability per ancestor (three levels above each owner). */
const ancestorMass = (blocks: TextBlock[], probabilities: Float32Array) => {
	const mass = new Map<Element, { p: number; w: number }>();
	const add = (element: Element | undefined, p: number, weight: number) => {
		if (!element) {
			return;
		}
		const entry = mass.get(element);
		if (entry) {
			entry.p += p * weight;
			entry.w += weight;
		} else {
			mass.set(element, { p: p * weight, w: weight });
		}
	};
	let docP = 0;
	let docW = 0;
	for (const block of blocks) {
		const weight = block.text.length + 10;
		const p = probabilities[block.index];
		add(ancestorAt(block, 1), p, weight);
		add(ancestorAt(block, 2), p, weight);
		add(ancestorAt(block, 3), p, weight);
		docP += p * weight;
		docW += weight;
	}
	const parentWeightShare = (element: Element | undefined): number => {
		const entry = element ? mass.get(element) : undefined;
		return entry && docW > 0 ? entry.w / docW : 0;
	};
	return { mass, docShare: docW === 0 ? 0 : docP / docW, parentWeightShare };
};

/** Distance in blocks to the nearest block at or above 0.5, in either direction. */
const distanceToHigh = (probabilities: Float32Array): Float32Array => {
	const count = probabilities.length;
	const distance = new Float32Array(count).fill(count);
	let last = -1;
	for (let index = 0; index < count; index++) {
		if (probabilities[index] >= 0.5) {
			last = index;
		}
		if (last >= 0) {
			distance[index] = index - last;
		}
	}
	last = -1;
	for (let index = count - 1; index >= 0; index--) {
		if (probabilities[index] >= 0.5) {
			last = index;
		}
		if (last >= 0) {
			distance[index] = Math.min(distance[index], last - index);
		}
	}
	return distance;
};

/**
 * Appends context aggregates of first-stage probabilities to every feature row.
 *
 * A block surrounded by main content, or inside a container whose text is mostly main content,
 * is main content far more often than its own features say — the sequential structure that
 * Web2Text and BoilerNet model with an HMM or an LSTM, captured here with a few averages.
 */
export const stackedFeatures = (blocks: TextBlock[], base: Float32Array, probabilities: Float32Array): Float32Array => {
	const count = blocks.length;
	const stride = STACKED_FEATURE_COUNT;
	const out = new Float32Array(count * stride);

	const { mass, docShare, parentWeightShare } = ancestorMass(blocks, probabilities);
	const meanOf = (element: Element | undefined, fallback: number) => {
		const entry = element ? mass.get(element) : undefined;
		return entry ? entry.p / entry.w : fallback;
	};
	const distance = distanceToHigh(probabilities);

	for (let index = 0; index < count; index++) {
		const row = index * stride;
		out.set(base.subarray(index * FEATURE_COUNT, (index + 1) * FEATURE_COUNT), row);
		const p = probabilities[index];
		const window = (radius: number) => {
			let sum = 0;
			let n = 0;
			for (let near = Math.max(0, index - radius); near <= Math.min(count - 1, index + radius); near++) {
				if (near !== index) {
					sum += probabilities[near];
					n += 1;
				}
			}
			return n === 0 ? p : sum / n;
		};
		const block = blocks[index];
		let f = row + FEATURE_COUNT;
		out[f++] = logit(p);
		out[f++] = window(1);
		out[f++] = window(3);
		out[f++] = meanOf(ancestorAt(block, 1), p);
		out[f++] = meanOf(ancestorAt(block, 2), p);
		out[f++] = meanOf(ancestorAt(block, 3), p);
		out[f++] = parentWeightShare(ancestorAt(block, 1));
		out[f++] = Math.log1p(distance[index]);
		out[f++] = docShare;
	}
	return out;
};
