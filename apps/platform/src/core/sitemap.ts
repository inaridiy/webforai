/**
 * sitemap.xml parsing (sitemaps.org protocol) for the opt-in crawl `sitemap` option.
 *
 * Pure: no I/O; the loader lives in `sitemap-fetch.ts`. A document is either a `<urlset>`
 * (page URLs) or a `<sitemapindex>` (further sitemap URLs). Only `<loc>` values are read —
 * `lastmod`/`priority` do not change what a crawl visits. No XML parser exists in Workers, and
 * the format is simple enough that a bounded, non-backtracking scan of `<loc>` elements is
 * both safer and faster than pulling one in.
 */

/** The protocol caps one sitemap at 50,000 URLs / 50 MB; a crawl never needs that many. */
export const MAX_SITEMAP_BYTES = 5 * 1024 * 1024;
export const MAX_SITEMAP_URLS = 5_000;

export interface Sitemap {
	kind: "urlset" | "index";
	/** Absolute http(s) URLs in document order, deduplicated, at most `MAX_SITEMAP_URLS`. */
	urls: string[];
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decodeEntities = (value: string): string =>
	value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => XML_ENTITIES[name] ?? "");

/**
 * `<loc>` contents, optionally namespace-prefixed (`<sm:loc>`), plain or CDATA (surrounding
 * whitespace is trimmed afterwards, never matched, so no two quantifiers compete). Both branches are
 * bounded and cannot run past a `<` (or a `]` inside CDATA), so a hostile document such as
 * `<loc>aaaa…` or an unclosed CDATA repeated through the size cap stays linear.
 */
const LOC_PATTERN =
	/<(?:[A-Za-z_][\w.-]*:)?loc>(?:<!\[CDATA\[([^\]<]{0,4096})\]\]>|([^<]{0,4096}))<\/(?:[A-Za-z_][\w.-]*:)?loc>/g;

const toHttpUrl = (raw: string): string | undefined => {
	try {
		const url = new URL(raw.trim());
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
	} catch {
		return undefined;
	}
};

export const parseSitemap = (text: string): Sitemap => {
	const body = text.slice(0, MAX_SITEMAP_BYTES);
	const kind = /<(?:[A-Za-z_][\w.-]*:)?sitemapindex[\s>]/.test(body) ? "index" : "urlset";
	const seen = new Set<string>();
	for (const match of body.matchAll(LOC_PATTERN)) {
		const url = toHttpUrl(match[1] ?? decodeEntities((match[2] ?? "").trim()));
		if (url) {
			seen.add(url);
			if (seen.size >= MAX_SITEMAP_URLS) {
				break;
			}
		}
	}
	return { kind, urls: [...seen] };
};
