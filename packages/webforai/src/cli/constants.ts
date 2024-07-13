export const DEFAULT_PATH = "https://example.com";

export const LOADERS = ["fetch", "playwright", "puppeteer"] as const;
export type Loaders = (typeof LOADERS)[number];

export const MODES: string[] = ["default", "ai"];
export type Modes = (typeof MODES)[number];
