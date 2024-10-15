import { takumiExtractor } from "./extractors/presets/takumi";

export const PRESET_EXTRACTORS = {
	takumi: takumiExtractor,
};

export const DEFAULT_EXTRACTORS = ["takumi" as const];
