/**
 * Public demo endpoint of the webforai platform.
 *
 * This is the single place the docs site knows about the platform host. Self-hosted docs
 * builds should change this constant.
 */
export const PLATFORM_DEMO_ENDPOINT = "https://platform.webforai.dev/v1/demo/scrape";

export const PLATFORM_REGIONS = ["auto", "us", "eu", "uk", "jp", "asia"] as const;

export type PlatformRegion = (typeof PLATFORM_REGIONS)[number];
