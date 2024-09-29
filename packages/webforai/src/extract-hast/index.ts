import type { Nodes as Hast } from "hast";
import { readabilityExtractHast } from "./readability";
import { stronglyExtractHast } from "./strongly";

export type ExtractPresets = "strongly" | "readability";
export type ExtractParams = { hast: Hast; lang?: string; url?: string };
export type Extractor = ((param: ExtractParams) => Hast) | false | ExtractPresets;
export type Extracotrs = Extractor | Extractor[];

export const PRESET_EXTRACT_HAST = {
	strongly: stronglyExtractHast,
	readability: readabilityExtractHast,
};

export const DEFAULT_EXTRACT_HAST: Extracotrs = ["readability"];

export const extractHast = (params: ExtractParams, extractors: Extracotrs = DEFAULT_EXTRACT_HAST): Hast => {
	const { hast, lang } = params;
	const _extractors = Array.isArray(extractors) ? extractors : [extractors];

	const extracted =
		_extractors.reduce<Hast>((acc, extractor) => {
			if (extractor === false) {
				return acc;
			}
			if (typeof extractor === "string" && extractor in PRESET_EXTRACT_HAST) {
				return PRESET_EXTRACT_HAST[extractor]({ hast: acc, lang });
			}
			if (typeof extractor === "function") {
				return extractor({ hast: acc, lang });
			}
			throw new Error(`Invalid extractor: ${extractor}`);
		}, hast) || hast;

	return extracted;
};
