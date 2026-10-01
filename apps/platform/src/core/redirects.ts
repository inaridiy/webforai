import { assertPublicHttpUrl } from "./ssrf";
import { PlatformError } from "./types";

/**
 * Manual redirect following with the SSRF guard on every hop.
 *
 * `redirect: "follow"` lets the runtime walk the whole chain and only shows us the last URL, so
 * a public page could bounce the request through `http://169.254.169.254/` (or any private
 * address) and the guard would see nothing until the response was already read. Every fetcher
 * therefore requests with `redirect: "manual"` and walks the chain here, validating each
 * `Location` before it is requested.
 *
 * Pure and runtime-agnostic (structural response type, injected single-hop fetch), so it is
 * shared by the Workers engines and the Node container's undici fetch alike.
 */

/** Browsers stop at 20; legitimate chains are far shorter, and every hop costs a subrequest. */
export const MAX_REDIRECTS = 10;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** The parts of a `Response` the walker needs; satisfied by both the DOM and undici types. */
export interface HopResponse {
	status: number;
	headers: { get(name: string): string | null };
	body: { cancel(reason?: unknown): Promise<void> } | null;
}

export interface FollowedResponse<R> {
	response: R;
	/** The URL that produced `response` — `response.url` is unreliable under manual redirects. */
	url: string;
}

export interface FollowOptions {
	maxRedirects?: number;
	/** Validates a hop target; defaults to `assertPublicHttpUrl`. Must throw to refuse. */
	assertUrl?: (url: string) => string;
}

const defaultAssert = (url: string): string => assertPublicHttpUrl(url).href;

/**
 * Requests `start`, then each redirect target in turn, through `fetchOne` — which must issue a
 * single request with `redirect: "manual"`. Returns the first non-redirect response.
 *
 * A 3xx without a usable `Location` is returned as-is (the caller's `!ok` handling reports it).
 * Throws `invalid_url` (400) when a hop is not a public http(s) URL, and `fetch_failed` (502)
 * when the chain is longer than `maxRedirects`.
 */
export const fetchFollowingRedirects = async <R extends HopResponse>(
	fetchOne: (url: string) => Promise<R>,
	start: string,
	{ maxRedirects = MAX_REDIRECTS, assertUrl = defaultAssert }: FollowOptions = {},
): Promise<FollowedResponse<R>> => {
	let url = assertUrl(start);
	for (let hop = 0; ; hop += 1) {
		const response = await fetchOne(url);
		const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get("location") : null;
		if (!location) {
			return { response, url };
		}

		// Redirect bodies are never read; release the connection before the next hop.
		await response.body?.cancel().catch(() => undefined);

		if (hop >= maxRedirects) {
			throw new PlatformError("fetch_failed", `too many redirects (more than ${maxRedirects}) from ${start}`, 502);
		}
		let next: string;
		try {
			next = new URL(location, url).href;
		} catch {
			throw new PlatformError("fetch_failed", `invalid redirect location "${location}" from ${url}`, 502);
		}
		url = assertUrl(next);
	}
};
