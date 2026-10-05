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
export { autoExtractor, createAutoExtractor, readabilityExtractor, type AutoExtractorOptions } from "./presets/auto";
export {
	agentExtractor,
	createAgentExtractor,
	LINK_ROLE_TITLES,
	type AgentExtractorOptions,
} from "./presets/agent";
export { LINK_ROLES, type LinkRole } from "./lib/roles";
