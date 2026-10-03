// biome-ignore lint/performance/noBarrelFile: module index
export {
	pipeExtractors,
	type ExtractorSelectors,
	type ExtractorSelector,
} from "./pipeExtractors";
export { takumiExtractor } from "./presets/takumi";
export { createKiwameExtractor, kiwameExtractor, type KiwameExtractorOptions } from "./presets/kiwame";
export { type ExtractParams, type ExtractionReport, type Extractor } from "./types";
export { minimalFilter } from "./presets/minimal-filter";
export { autoExtractor, createAutoExtractor, type AutoExtractorOptions } from "./presets/auto";
