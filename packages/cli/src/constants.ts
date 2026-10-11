import { EXTRACTOR_PRESETS, type ExtractorPreset } from "webforai/platform";

export const DEFAULT_PATH = "https://example.com";

/**
 * How the CLI acquires HTML (`local` is selected automatically for file paths):
 * - `fetch` — plain HTTP fetch, no JavaScript execution.
 * - `playwright` — local headless Chromium (must be installed).
 * - `platform` — the hosted webforai platform API; also converts server-side.
 */
export const LOADERS = ["fetch", "playwright", "platform"] as const;
export type Loader = (typeof LOADERS)[number] | "local";

export const MODES = ["default", "ai"] as const;
export type Mode = (typeof MODES)[number];

/** Extraction presets, for local conversion and the hosted platform alike. */
export const EXTRACTORS = EXTRACTOR_PRESETS;
export type ExtractorName = ExtractorPreset;

export const API_KEY_ENV = "WEBFORAI_API_KEY";
export const PLATFORM_URL_ENV = "WEBFORAI_PLATFORM_URL";
