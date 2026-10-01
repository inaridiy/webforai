/**
 * Egress regions for the proxied engines.
 *
 * Limited to what the proxy plan can actually honour: its pool has dedicated Japanese exit IPs
 * and otherwise unspecified-country ones (2026-09-24), so only `jp` can be promised. Adding a
 * region means adding IPs in that country to the plan first, then a row here.
 *
 * `auto` means "no geo-targeting": the proxy picks any exit IP, which is the cheapest and most
 * available option, so it stays the default everywhere.
 *
 * Only `proxy-fetch` and `proxy-browser` can honour a region; `fetch` and `browser` egress
 * from Cloudflare and ignore it rather than pretending to support it.
 */
export const REGIONS = ["auto", "jp"] as const;
export type Region = (typeof REGIONS)[number];

/** Region → ISO 3166-1 alpha-2 country code the proxy gateway understands as a `-{CC}-` username segment. */
export const REGION_COUNTRY: Record<Exclude<Region, "auto">, string> = {
	jp: "JP",
};

/** `auto` maps to `undefined` — the absence of a country is what disables geo-targeting. */
export const regionToCountry = (region: Region): string | undefined =>
	region === "auto" ? undefined : REGION_COUNTRY[region];
