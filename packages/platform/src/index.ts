// biome-ignore lint/performance/noBarrelFile: module index
export {
	DEFAULT_BASE_URL,
	createPlatformClient,
	type PlatformClient,
	type PlatformClientOptions,
	type WaitForJobOptions,
} from "./client.js";
export { PlatformApiError } from "./error.js";
export type { FetchLike, FetchRequestInit, FetchResponseLike } from "./fetch.js";
export {
	ENGINES,
	REGIONS,
	isStoredPageStub,
	type BatchOptions,
	type ConvertOptions,
	type CrawlOptions,
	type DemoResult,
	type DemoScrapeOptions,
	type Engine,
	type ExtractorPreset,
	type JobRef,
	type JobResultItem,
	type JobResultsPage,
	type JobState,
	type JobStatus,
	type JobType,
	type PageError,
	type PageFailure,
	type PageResult,
	type PageSuccess,
	type Region,
	type ScrapeOptions,
	type ScrapeResult,
	type StoredPageStub,
} from "./types.js";
