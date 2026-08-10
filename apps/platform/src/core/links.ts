/**
 * Link discovery for recursive crawls.
 *
 * Runs on the raw fetched HTML (before extraction, which drops navigation), so crawls can
 * traverse a site through its chrome while conversion still strips it.
 */

const HREF_PATTERN = /<a\s[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;

export interface CrawlScope {
	/** Origin pages must share; from the seed URL. */
	origin: string;
	includePaths?: string[];
	excludePaths?: string[];
}

/** Extracts, resolves, and filters crawlable links from an HTML document. */
export const discoverLinks = (html: string, pageUrl: string, scope: CrawlScope): string[] => {
	const found = new Set<string>();

	for (const match of html.matchAll(HREF_PATTERN)) {
		const raw = (match[2] ?? match[3] ?? match[4] ?? "").trim();
		if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(raw)) {
			continue;
		}
		const normalized = normalizeCrawlUrl(raw, pageUrl);
		if (normalized && inScope(normalized, scope)) {
			found.add(normalized.href);
		}
	}

	return [...found];
};

/** Resolves against the page URL, strips fragments, and keeps only http(s). */
export const normalizeCrawlUrl = (raw: string, base: string): URL | undefined => {
	let url: URL;
	try {
		url = new URL(raw, base);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return undefined;
	}
	url.hash = "";
	return url;
};

const inScope = (url: URL, scope: CrawlScope): boolean => {
	if (url.origin !== scope.origin) {
		return false;
	}
	if (scope.includePaths?.length && !scope.includePaths.some((pattern) => safeTest(pattern, url.pathname))) {
		return false;
	}
	if (scope.excludePaths?.some((pattern) => safeTest(pattern, url.pathname))) {
		return false;
	}
	return true;
};

/** User-supplied patterns must never crash a job. Invalid regexes match nothing. */
const safeTest = (pattern: string, value: string): boolean => {
	try {
		return new RegExp(pattern).test(value);
	} catch {
		return false;
	}
};

/**
 * BFS frontier for a crawl. Pure and serialization-friendly: Workflows persist state
 * between steps, so the frontier is plain data.
 */
export interface CrawlFrontier {
	/** URLs queued or already fetched; guards against re-enqueueing. */
	seen: string[];
	/** [url, depth] pairs still to fetch. */
	queue: [string, number][];
}

export const createFrontier = (seedUrl: string): CrawlFrontier => ({
	seen: [seedUrl],
	queue: [[seedUrl, 0]],
});

export const enqueueLinks = (
	frontier: CrawlFrontier,
	links: string[],
	depth: number,
	limits: { maxDepth: number; limit: number },
): CrawlFrontier => {
	if (depth > limits.maxDepth) {
		return frontier;
	}
	const seen = new Set(frontier.seen);
	const queue = [...frontier.queue];
	for (const link of links) {
		if (seen.size >= limits.limit || seen.has(link)) {
			continue;
		}
		seen.add(link);
		queue.push([link, depth]);
	}
	return { seen: [...seen], queue };
};
