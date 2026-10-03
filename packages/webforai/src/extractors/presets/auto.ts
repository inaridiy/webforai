/**
 * The default extractor: a site adapter when one applies, the learned block classifier otherwise.
 *
 * Keeping the fallback inside a single extractor (rather than chaining two pipeline stages)
 * matters, because generic extraction must run on the *original* document. An adapter's output
 * is already just the content, and re-scoring it would let the heuristics prune text that the
 * site-specific rules deliberately kept.
 */

import type { Nodes as Hast } from "hast";

import { runAdapters } from "../../adapters";
import type { SiteAdapter } from "../../adapters/types";
import type { ExtractParams, Extractor } from "../types";
import { kiwameExtractor } from "./kiwame";

export interface AutoExtractorOptions {
	/**
	 * Adapters to consider. Pass `false` to disable site-specific handling entirely, or an array
	 * to restrict or extend the built-in set.
	 */
	adapters?: SiteAdapter[] | false;
	/**
	 * Extractor for pages no adapter claims. Defaults to `kiwameExtractor`, which itself falls
	 * back to the heuristic `takumiExtractor` when its model keeps nothing.
	 */
	fallback?: Extractor;
}

/**
 * Creates the default extractor.
 *
 * @param options - {@link AutoExtractorOptions}
 */
export const createAutoExtractor = (options: AutoExtractorOptions = {}): Extractor => {
	const { adapters, fallback = kiwameExtractor } = options;

	return (params: ExtractParams): Hast => {
		if (adapters !== false) {
			const extracted = runAdapters({ hast: params.hast, url: params.url, lang: params.lang }, adapters ?? undefined);
			if (extracted) {
				params.report?.({ extractor: "adapter" });
				return extracted;
			}
		}

		return fallback(params);
	};
};

/**
 * Extracts page content, preferring a site-specific adapter when one recognises the page.
 *
 * @param params - {@link ExtractParams}
 * @returns The HAST tree containing the page's content.
 */
export const autoExtractor: Extractor = createAutoExtractor();
