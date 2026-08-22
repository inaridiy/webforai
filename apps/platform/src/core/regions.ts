/**
 * Coarse egress regions for the proxied engines.
 *
 * The API deliberately exposes a *region*, not a country: the proxy pool's composition changes,
 * and a caller asking for "eu" wants an EU-looking exit IP, not a guarantee about one country.
 * Each region therefore maps to one **representative** country whose exit-node coverage is
 * reliable — the mapping is not exhaustive, and a request for `eu` may be served from Germany
 * today and another EU country tomorrow if this table changes.
 *
 * `auto` means "no geo-targeting": the proxy picks any exit IP, which is the cheapest and most
 * available option, so it stays the default everywhere.
 *
 * Only `proxy-fetch` and `proxy-browser` can honour a region; `fetch` and `browser` egress
 * from Cloudflare and ignore it rather than pretending to support it.
 */
export const REGIONS = ["auto", "us", "eu", "uk", "jp", "asia"] as const;
export type Region = (typeof REGIONS)[number];

/** Region → ISO 3166-1 alpha-2 country code the proxy gateway understands as a `-{CC}-` username segment. */
export const REGION_COUNTRY: Record<Exclude<Region, "auto">, string> = {
	us: "US",
	eu: "DE",
	uk: "GB",
	jp: "JP",
	asia: "SG",
};

/** `auto` maps to `undefined` — the absence of a country is what disables geo-targeting. */
export const regionToCountry = (region: Region): string | undefined =>
	region === "auto" ? undefined : REGION_COUNTRY[region];
