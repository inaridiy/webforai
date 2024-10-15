import type { Nodes as Hast } from "hast";
import { takumiExtractor } from "./presets/takumi";
import type { ExtractParams, Extractor } from "./types";

export const PRESET_EXTRACTORS = {
	takumi: takumiExtractor,
};

export type PresetExtractors = keyof typeof PRESET_EXTRACTORS;

type ExtractorSelector = Extractor | false | PresetExtractors;
export type ExtractorSelectors = ExtractorSelector | ExtractorSelector[];

export const DEFAULT_EXTRACTORS: ExtractorSelectors = ["takumi"];

export const pipeExtractors = (params: ExtractParams, extractors: ExtractorSelectors = DEFAULT_EXTRACTORS): Hast => {
	const { hast, lang } = params;
	const _extractors = Array.isArray(extractors) ? extractors : [extractors];

	const extracted =
		_extractors.reduce<Hast>((acc, extractor) => {
			if (extractor === false) {
				return acc;
			}
			if (typeof extractor === "string" && extractor in PRESET_EXTRACTORS) {
				return PRESET_EXTRACTORS[extractor]({ hast: acc, lang });
			}
			if (typeof extractor === "function") {
				return extractor({ hast: acc, lang });
			}
			throw new Error(`Invalid extractor: ${extractor}`);
		}, hast) || hast;

	return extracted;
};
