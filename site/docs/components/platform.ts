/**
 * Origin of the hosted webforai platform.
 *
 * Components read the platform host from here (MDX prose and vocs.config.ts links spell it
 * out). Self-hosted docs builds should change this constant.
 */
export const PLATFORM_ORIGIN = "https://platform.webforai.dev";

/** Public, keyless demo endpoint behind the landing page's "Try it" box. */
export const PLATFORM_DEMO_ENDPOINT = `${PLATFORM_ORIGIN}/v1/demo/scrape`;

export const PLATFORM_REGIONS = ["auto", "us", "eu", "uk", "jp", "asia"] as const;

export type PlatformRegion = (typeof PLATFORM_REGIONS)[number];
