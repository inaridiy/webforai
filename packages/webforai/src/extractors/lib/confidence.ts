/**
 * Page-level confidence of the learned extractor: an estimate of how well its selection matches
 * the page's main content, from 0 (probably wrong) to 1 (probably right).
 *
 * Most pages come out well and a minority fail badly (a listing whose items were all dropped, an
 * article whose navigation was kept). Those failures are visible in how the block probabilities
 * are spread over the page and in whether an independent extractor agrees, so a small model over
 * a dozen page aggregates predicts the page's expected token F1. Callers can use it to decide
 * what to trust, retry with different options, or flag a page for review.
 */

import type { Element } from "hast";

import { type BlockModel, isUsableModel, scoreBlocks } from "./block-model";
import type { TextBlock } from "./blocks";

export const CONFIDENCE_FEATURE_NAMES = [
	"p_max",
	"p_mean",
	"p_entropy",
	"share_above_half",
	"share_uncertain",
	"share_above_09",
	"log_blocks",
	"log_chars",
	"kept_share",
	"takumi_agreement",
	"takumi_share",
	"fell_back",
] as const;

export const CONFIDENCE_FEATURE_COUNT = CONFIDENCE_FEATURE_NAMES.length;

export interface ConfidenceInput {
	blocks: TextBlock[];
	/** Final block probabilities (after stacking). */
	probabilities: Float32Array;
	/** Blocks are kept at or above this probability. */
	threshold: number;
	/** Block owners the heuristic extractor keeps. */
	takumiKept?: Set<Element>;
	/** True when nothing reached the threshold and the heuristic extractor took over. */
	fellBack: boolean;
}

/** Text-weighted sums over the page's blocks. */
interface Sums {
	total: number;
	mean: number;
	entropy: number;
	aboveHalf: number;
	uncertain: number;
	above09: number;
	max: number;
	kept: number;
	takumi: number;
	both: number;
	either: number;
}

const sumsOf = ({ blocks, probabilities, threshold, takumiKept }: ConfidenceInput): Sums => {
	const sums: Sums = {
		total: 0,
		mean: 0,
		entropy: 0,
		aboveHalf: 0,
		uncertain: 0,
		above09: 0,
		max: 0,
		kept: 0,
		takumi: 0,
		both: 0,
		either: 0,
	};
	for (const block of blocks) {
		const weight = block.text.length + 10;
		const p = probabilities[block.index];
		const isKept = p >= threshold;
		const isTakumi = takumiKept?.has(block.owner) ?? false;
		sums.total += weight;
		sums.mean += p * weight;
		sums.entropy -= weight * (p * Math.log(p + 1e-6) + (1 - p) * Math.log(1 - p + 1e-6));
		sums.aboveHalf += p >= 0.5 ? weight : 0;
		sums.uncertain += p > 0.2 && p < 0.6 ? weight : 0;
		sums.above09 += p >= 0.9 ? weight : 0;
		sums.max = Math.max(sums.max, p);
		sums.kept += isKept ? weight : 0;
		sums.takumi += isTakumi ? weight : 0;
		sums.both += isKept && isTakumi ? weight : 0;
		sums.either += isKept || isTakumi ? weight : 0;
	}
	return sums;
};

/** The page aggregates the confidence model reads, in CONFIDENCE_FEATURE_NAMES order. */
export const confidenceFeatures = (input: ConfidenceInput): Float32Array => {
	const sums = sumsOf(input);
	const share = (value: number) => (sums.total > 0 ? value / sums.total : 0);
	return Float32Array.from([
		sums.max,
		share(sums.mean),
		share(sums.entropy),
		share(sums.aboveHalf),
		share(sums.uncertain),
		share(sums.above09),
		Math.log1p(input.blocks.length),
		Math.log1p(sums.total),
		share(sums.kept),
		sums.either > 0 ? sums.both / sums.either : 1,
		share(sums.takumi),
		input.fellBack ? 1 : 0,
	]);
};

/** Expected page F1 under `model`, or `undefined` without a usable model. */
export const scoreConfidence = (features: Float32Array, model: BlockModel | undefined): number | undefined => {
	if (!(model && isUsableModel(model, CONFIDENCE_FEATURE_COUNT))) {
		return undefined;
	}
	const [value] = scoreBlocks(features, 1, model, CONFIDENCE_FEATURE_COUNT);
	return Math.round(value * 1000) / 1000;
};
