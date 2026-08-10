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
	minimalFilter,
	type AutoExtractorOptions,
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

export { extractMetadata, toFrontmatter, type PageMetadata } from "./metadata";
export { normalizeHast, type NormalizeOptions } from "./normalize";
