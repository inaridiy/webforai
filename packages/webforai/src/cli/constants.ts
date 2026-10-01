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

export const EXTRACTORS = ["auto", "kiwame", "takumi", "minimal", "none"] as const;
export type ExtractorName = (typeof EXTRACTORS)[number];

/** Presets the hosted platform accepts; `kiwame` is local-only for now. */
export const PLATFORM_EXTRACTORS = ["auto", "takumi", "minimal", "none"] as const;

export const API_KEY_ENV = "WEBFORAI_API_KEY";
export const PLATFORM_URL_ENV = "WEBFORAI_PLATFORM_URL";
