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
	takumiExtractor,
	learnedExtractor,
	createLearnedExtractor,
	minimalFilter,
	type AutoExtractorOptions,
	type LearnedExtractorOptions,
	type ExtractorSelectors,
	type ExtractorSelector,
	type ExtractParams,
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
