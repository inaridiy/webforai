import type { Nodes as Hast } from "hast";
import { DEFAULT_EXTRACTORS } from "../constants";
import type { ExtractParams, Extractor } from "./types";

export type ExtractorSelector = Extractor | false;
export type ExtractorSelectors = ExtractorSelector | ExtractorSelector[];

/**
 * Runs extractors in sequence, feeding each one the previous one's output.
 *
 * `false` entries are skipped, so callers can toggle a stage without rebuilding the array.
 */
export const pipeExtractors = (params: ExtractParams, extractors: ExtractorSelectors = DEFAULT_EXTRACTORS): Hast => {
	const { hast, lang, url, owned } = params;
	const list = Array.isArray(extractors) ? extractors : [extractors];

	let current = hast;
	// After the first extractor has run, the tree it returned is ours: every extractor either
	// cloned its input or was told it owned it, so later stages may always mutate in place.
	let currentOwned = owned ?? false;

	for (const extractor of list) {
		if (extractor === false) {
			continue;
		}
		if (typeof extractor !== "function") {
			throw new Error(`Invalid extractor: ${String(extractor)}`);
		}

		current = extractor({ hast: current, lang, url, owned: currentOwned });
		currentOwned = true;
	}

	return current;
};
