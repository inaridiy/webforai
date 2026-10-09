// biome-ignore lint/performance/noBarrelFile: module index
export {
	htmlToMarkdown,
	htmlToMarkdownWithMetadata,
	type HtmlToMarkdownOptions,
	type HtmlToMarkdownResult,
} from "./html-to-markdown";
export { mdastSplitter } from "./md-splitter";
export { htmlToMdast, type HtmlToMdastOptions } from "./html-to-mdast";
export { mdastToMarkdown, type MdastToMarkdownOptions } from "./mdast-to-markdown";

export {
	pipeExtractors,
	autoExtractor,
	createAutoExtractor,
	readabilityExtractor,
	agentExtractor,
	commentsExtractor,
	createAgentExtractor,
	LINK_ROLES,
	LINK_ROLE_TITLES,
	EXTRACTOR_PRESETS,
	presetExtractors,
	takumiExtractor,
	kiwameExtractor,
	createKiwameExtractor,
	minimalFilter,
	type AutoExtractorOptions,
	type AgentExtractorOptions,
	type LinkRole,
	type RoleModels,
	type ExtractorPreset,
	type KiwameExtractorOptions,
	type ScoredPage,
	type ExtractorSelectors,
	type ExtractorSelector,
	type ExtractParams,
	type ExtractionReport,
	type Extractor,
} from "./extractors";

export {
	BUILTIN_ADAPTERS,
	adapterById,
	buildPageSignature,
	defineSelectorAdapter,
	resolveAdapter,
	runAdapters,
	youtubeCaptionTracks,
	type AdapterContext,
	type CaptionTrack,
	type PageSignature,
	type SelectorAdapterSpec,
	type SiteAdapter,
} from "./adapters";

export {
	detectClientShell,
	SHELL_EMPTY_THRESHOLD,
	SHELL_SUSPICION_THRESHOLD,
	type ClientShellReason,
	type ClientShellVerdict,
} from "./detect-client-shell";
export {
	extractMetaRefresh,
	MAX_META_REFRESH_DELAY_SECONDS,
	type MetaRefreshTarget,
} from "./extract-meta-refresh";
export { extractMetadata, toFrontmatter, type PageMetadata } from "./metadata";
export { normalizeHast, type NormalizeOptions } from "./normalize";
export { stripScriptBodies } from "./utils/parse-html";
