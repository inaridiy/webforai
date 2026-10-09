import type { ExtractorSelectors } from "../pipeExtractors";
import type { ExtractorPreset } from "../preset-names";
import { agentExtractor, commentsExtractor } from "./agent";
import { readabilityExtractor } from "./auto";
import { kiwameExtractor } from "./kiwame";
import { minimalFilter } from "./minimal-filter";
import { takumiExtractor } from "./takumi";

/**
 * The `extractors` option for a preset name. `auto` (and no preset) returns `undefined`, which
 * keeps the library's default; `none` returns `false`, which converts the whole document.
 *
 * Imports every preset, the agent extractor's role models included; import the extractors
 * themselves when bundle size matters.
 *
 * @example
 * ```ts
 * import { htmlToMarkdown, presetExtractors } from "webforai";
 *
 * const markdown = htmlToMarkdown(html, { url, extractors: presetExtractors("agent") });
 * ```
 */
export const presetExtractors = (preset: ExtractorPreset | undefined): ExtractorSelectors | undefined => {
	switch (preset) {
		case "readability":
			return readabilityExtractor;
		case "agent":
			return agentExtractor;
		case "comments":
			return commentsExtractor;
		case "kiwame":
			return kiwameExtractor;
		case "takumi":
			return takumiExtractor;
		case "minimal":
			return minimalFilter;
		case "none":
			return false;
		default:
			return undefined;
	}
};
