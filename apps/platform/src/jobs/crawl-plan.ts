import { type CrawlFrontier, createFrontier, enqueueLinks } from "../core/links";

/**
 * BFS traversal for a crawl job.
 *
 * Kept free of Cloudflare imports (and of the Workflow itself) for two reasons: it is the part
 * of a crawl that has to be *exactly* reproducible — Workflows re-run `run()` and replay cached
 * step results, so an identical sequence of visitor results must produce an identical visit
 * order — and that property is only worth anything if it can be tested directly.
 */

export interface CrawlLimits {
	maxDepth: number;
	limit: number;
}

export interface CrawlVisit {
	url: string;
	/** Zero-based page index; doubles as the KV result key suffix. */
	index: number;
	depth: number;
}

/** Returns the links discovered on the page, or `undefined` to abort the whole crawl. */
export type CrawlVisitor = (visit: CrawlVisit) => Promise<{ links: string[] } | undefined>;

export interface CrawlTraversal {
	visited: number;
	aborted: boolean;
}

export interface CrawlSeeding {
	/** Extra URLs (from the site's sitemaps) queued at depth 1 right after the seed's own links. */
	sitemapUrls?: string[];
	/** `false` visits only the seed and `sitemapUrls`: links found on pages are not followed. */
	followLinks?: boolean;
}

export const traverseCrawl = async (
	seedUrl: string,
	limits: CrawlLimits,
	visit: CrawlVisitor,
	{ sitemapUrls = [], followLinks = true }: CrawlSeeding = {},
): Promise<CrawlTraversal> => {
	// `enqueueLinks` only ever appends, so a read cursor over the queue stays valid across every
	// rebuild — no shifting, and therefore no dependence on mutation order.
	let frontier: CrawlFrontier = createFrontier(seedUrl);
	let cursor = 0;
	let index = 0;

	while (cursor < frontier.queue.length && index < limits.limit) {
		const entry = frontier.queue[cursor];
		cursor += 1;
		if (!entry) {
			break;
		}
		const [url, depth] = entry;

		const outcome = await visit({ url, index, depth });
		index += 1;
		if (!outcome) {
			return { visited: index, aborted: true };
		}

		if (followLinks) {
			frontier = enqueueLinks(frontier, outcome.links, depth + 1, limits);
		}
		if (index === 1 && sitemapUrls.length > 0) {
			// Sitemap URLs sit at depth 1; in sitemap-only mode no link is ever followed, so depth
			// limits nothing and `maxDepth: 0` must not silently drop the whole sitemap.
			const depthLimits = followLinks ? limits : { ...limits, maxDepth: Math.max(limits.maxDepth, 1) };
			frontier = enqueueLinks(frontier, sitemapUrls, 1, depthLimits);
		}
	}

	return { visited: index, aborted: false };
};
