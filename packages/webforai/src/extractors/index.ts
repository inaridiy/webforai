// biome-ignore lint/performance/noBarrelFile: module index
export {
	pipeExtractors,
	type ExtractorSelectors,
	type ExtractorSelector,
} from "./pipeExtractors";
export { takumiExtractor } from "./presets/takumi";
export { createLearnedExtractor, learnedExtractor, type LearnedExtractorOptions } from "./presets/learned";
export { type ExtractParams, type Extractor } from "./types";
export { minimalFilter } from "./presets/minimal-filter";
export { autoExtractor, createAutoExtractor, type AutoExtractorOptions } from "./presets/auto";
