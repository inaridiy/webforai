/**
 * Runtime evaluation of the block classifier.
 *
 * Two model shapes are supported, both plain generated arrays: a linear model
 * (logistic regression) and an ensemble of complete binary trees of fixed depth, stored flat —
 * tree `t`'s internal node `i` is at `t * internalCount + i`, its children at `2i+1` and `2i+2`.
 */

import { FEATURE_COUNT } from "./block-features";

export interface LinearBlockModel {
	kind: "linear";
	/** Weights over raw features in FEATURE_NAMES order; index 0 is the bias. */
	weights: readonly number[];
}

export interface TreeBlockModel {
	kind: "trees";
	depth: number;
	base: number;
	/** Feature index per internal node; -1 always goes left. */
	features: readonly number[];
	/** Go left when `feature <= threshold`. */
	thresholds: readonly number[];
	/** Leaf values, `2^depth` per tree. */
	leaves: readonly number[];
}

export type BlockModel = LinearBlockModel | TreeBlockModel;

/** True when a model matches a feature layout of `stride` features. */
export const isUsableModel = (model: BlockModel, stride: number = FEATURE_COUNT): boolean => {
	if (model.kind === "linear") {
		return model.weights.length === stride;
	}
	const internal = 2 ** model.depth - 1;
	const trees = model.features.length / internal;
	return (
		Number.isInteger(trees) &&
		trees > 0 &&
		model.thresholds.length === model.features.length &&
		model.leaves.length === trees * (internal + 1) &&
		model.features.every((feature) => feature < stride)
	);
};

/** Probability of each block being main content. */
export const scoreBlocks = (
	features: Float32Array,
	count: number,
	model: BlockModel,
	stride: number = FEATURE_COUNT,
): Float32Array => {
	const out = new Float32Array(count);
	if (model.kind === "linear") {
		const { weights } = model;
		for (let index = 0; index < count; index++) {
			const row = index * stride;
			let sum = 0;
			for (let feature = 0; feature < stride; feature++) {
				sum += weights[feature] * features[row + feature];
			}
			out[index] = 1 / (1 + Math.exp(-sum));
		}
		return out;
	}

	const internal = 2 ** model.depth - 1;
	const leafCount = internal + 1;
	const trees = model.features.length / internal;
	const { features: splitFeatures, thresholds, leaves, base } = model;
	for (let index = 0; index < count; index++) {
		const row = index * stride;
		let sum = base;
		for (let tree = 0; tree < trees; tree++) {
			const offset = tree * internal;
			let node = 0;
			while (node < internal) {
				const feature = splitFeatures[offset + node];
				node = feature < 0 || features[row + feature] <= thresholds[offset + node] ? 2 * node + 1 : 2 * node + 2;
			}
			sum += leaves[tree * leafCount + node - internal];
		}
		out[index] = 1 / (1 + Math.exp(-sum));
	}
	return out;
};
