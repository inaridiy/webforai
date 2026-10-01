import { PLATFORM_USER_AGENT } from "../engines/workers-fetch";
import { fetchFollowingRedirects } from "./redirects";
import type { FetchLike } from "./rehost";
import type { RobotsTxtLoader } from "./robots-fetch";
import { readTruncated } from "./robots-fetch";
import { MAX_SITEMAP_BYTES, parseSitemap } from "./sitemap";

/**
 * Finds a site's page URLs through its sitemaps, for the crawl `sitemap` option.
 *
 * Candidates are the robots.txt `Sitemap:` lines, else `<origin>/sitemap.xml`. A sitemap index
 * is expanded breadth-first. Best-effort like the robots loader: any failure (status, timeout,
 * a redirect to a private address, malformed XML) contributes no URLs rather than failing the
 * crawl. Gzipped sitemaps (`.xml.gz`) are decompressed.
 */
export type SitemapLoader = (seed: URL, maxUrls: number) => Promise<string[]>;

/** Sitemap documents fetched per crawl, index files included; each one is a subrequest. */
export const MAX_SITEMAP_FETCHES = 8;
export const SITEMAP_TIMEOUT_MS = 10_000;

const isGzip = (url: string, contentType: string | null): boolean =>
	/\.gz$/i.test(new URL(url).pathname) || /gzip/i.test(contentType ?? "");

const fetchSitemapText = async (fetchImpl: FetchLike, start: string): Promise<string | undefined> => {
	const signal = AbortSignal.timeout(SITEMAP_TIMEOUT_MS);
	const { response, url } = await fetchFollowingRedirects(
		(hop) =>
			fetchImpl(hop, {
				method: "GET",
				redirect: "manual",
				headers: { "user-agent": PLATFORM_USER_AGENT, accept: "application/xml,text/xml;q=0.9,*/*;q=0.5" },
				signal,
			}),
		start,
	);
	if (!response.ok) {
		await response.body?.cancel().catch(() => undefined);
		return undefined;
	}
	const body =
		response.body && isGzip(url, response.headers.get("content-type"))
			? response.body.pipeThrough(new DecompressionStream("gzip"))
			: response.body;
	return readTruncated(body, MAX_SITEMAP_BYTES);
};

const addUpTo = (into: Set<string>, urls: string[], max: number): void => {
	for (const url of urls) {
		if (into.size >= max) {
			return;
		}
		into.add(url);
	}
};

export const createSitemapLoader =
	(robotsTxt: RobotsTxtLoader, fetchImpl: FetchLike = (input, init) => fetch(input, init)): SitemapLoader =>
	async (seed, maxUrls) => {
		const robots = await robotsTxt(seed).catch(() => undefined);
		const pending = robots?.sitemaps.length ? [...robots.sitemaps] : [`${seed.origin}/sitemap.xml`];
		const visited = new Set<string>();
		const urls = new Set<string>();

		while (pending.length > 0 && visited.size < MAX_SITEMAP_FETCHES && urls.size < maxUrls) {
			const next = pending.shift() as string;
			if (visited.has(next)) {
				continue;
			}
			visited.add(next);
			const text = await fetchSitemapText(fetchImpl, next).catch(() => undefined);
			if (text === undefined) {
				continue;
			}
			const sitemap = parseSitemap(text);
			if (sitemap.kind === "index") {
				pending.push(...sitemap.urls);
			} else {
				addUpTo(urls, sitemap.urls, maxUrls);
			}
		}

		return [...urls];
	};
