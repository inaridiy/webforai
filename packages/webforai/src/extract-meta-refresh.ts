/**
 * Meta-refresh redirect detection.
 *
 * Some sites answer HTTP 200 with a stub page whose only job is to send the browser
 * elsewhere — `<meta http-equiv="refresh" content="0; url=/ja/">`, typically paired with a
 * JavaScript fallback (GitHub Pages language redirects are the canonical case). HTTP-level
 * redirect following never triggers on these, so a fetch-based pipeline converts the stub
 * and loses the page. This parser lets loaders treat such a page as the redirect it is.
 *
 * A refresh only counts as a redirect when it names a URL, the URL resolves to http(s),
 * the target is not the page itself, and the delay is small — long delays are auto-reload
 * timers (live blogs, dashboards), not redirects.
 */

export interface MetaRefreshTarget {
	/** The redirect target, resolved against `baseUrl` when one was given. */
	url: string;
	delaySeconds: number;
}

/** Above this delay a refresh is an auto-reload timer, not a redirect. */
export const MAX_META_REFRESH_DELAY_SECONDS = 10;

const META_TAG_PATTERN = /<meta\b[^>]*>/gi;
const HTTP_EQUIV_REFRESH_PATTERN = /\bhttp-equiv\s*=\s*("\s*refresh\s*"|'\s*refresh\s*'|refresh\b)/i;
const CONTENT_ATTR_PATTERN = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/** `content="5; url='/ja/'"` — a delay, then an optional url= clause in optional quotes. */
const CONTENT_VALUE_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[;,]\s*url\s*=\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/i;

const resolveTarget = (raw: string, baseUrl: string | undefined): URL | undefined => {
	try {
		return baseUrl === undefined ? new URL(raw) : new URL(raw, baseUrl);
	} catch {
		return undefined;
	}
};

/**
 * Extracts the redirect a page's meta-refresh declares, if any.
 *
 * @param html - The fetched document.
 * @param baseUrl - The document's own URL; used to resolve relative targets and to reject
 *   self-refreshes. Without it, only absolute targets are recognised.
 * @returns The target and delay, or `undefined` when the page declares no usable redirect.
 */
export const extractMetaRefresh = (html: string, baseUrl?: string): MetaRefreshTarget | undefined => {
	for (const [tag] of html.matchAll(META_TAG_PATTERN)) {
		if (!HTTP_EQUIV_REFRESH_PATTERN.test(tag)) {
			continue;
		}
		const contentMatch = CONTENT_ATTR_PATTERN.exec(tag);
		const content = contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3];
		if (!content) {
			continue;
		}

		const value = CONTENT_VALUE_PATTERN.exec(content);
		if (!value) {
			continue;
		}
		const delaySeconds = Number.parseFloat(value[1] ?? "");
		const raw = (value[2] ?? value[3] ?? value[4] ?? "").trim();
		if (!raw || !Number.isFinite(delaySeconds) || delaySeconds > MAX_META_REFRESH_DELAY_SECONDS) {
			continue;
		}

		const target = resolveTarget(raw, baseUrl);
		if (!target || (target.protocol !== "http:" && target.protocol !== "https:")) {
			continue;
		}
		if (baseUrl !== undefined && resolveTarget(baseUrl, undefined)?.href === target.href) {
			// A page refreshing to itself is a reload loop, never a redirect worth following.
			continue;
		}

		return { url: target.href, delaySeconds };
	}

	return undefined;
};
