import { PLATFORM_USER_AGENT } from "../engines/workers-fetch";
import { fetchFollowingRedirects } from "./redirects";
import type { FetchLike } from "./rehost";
import { ALLOW_ALL, MAX_ROBOTS_TXT_BYTES, type RobotsTxt, parseRobotsTxt, robotsTxtUrl } from "./robots";

/**
 * Loads `<origin>/robots.txt` for the opt-in `respectRobotsTxt` check.
 *
 * Deliberately simple and permissive: anything other than a 2xx text response — a 4xx, a 5xx,
 * a network error, the timeout, a non-text body, a redirect to a private address — counts as
 * "no rules", so the page is fetched as if the option were off.
 *
 * The request asks Cloudflare's edge cache to keep the file for an hour (`cf.cacheTtl` with
 * `cacheEverything`), so checking many pages of one site does not refetch it every time and
 * no cross-request state is kept in the isolate.
 */
export type RobotsTxtLoader = (target: URL) => Promise<RobotsTxt>;

export const ROBOTS_TIMEOUT_MS = 5_000;
export const ROBOTS_CACHE_TTL_SECONDS = 3_600;

const isTextual = (contentType: string | null): boolean => {
	if (!contentType) {
		return true;
	}
	const essence = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	return essence.startsWith("text/");
};

/** Reads at most `maxBytes` of the body and drops the rest instead of failing. */
export const readTruncated = async (body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string> => {
	if (!body) {
		return "";
	}
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (size < maxBytes) {
		const chunk = await reader.read();
		if (chunk.done) {
			break;
		}
		chunks.push(chunk.value);
		size += chunk.value.byteLength;
	}
	await reader.cancel().catch(() => undefined);
	const merged = new Uint8Array(Math.min(size, maxBytes));
	let offset = 0;
	for (const part of chunks) {
		const room = merged.byteLength - offset;
		if (room <= 0) {
			break;
		}
		merged.set(part.subarray(0, room), offset);
		offset += Math.min(part.byteLength, room);
	}
	return new TextDecoder().decode(merged);
};

export const createRobotsTxtLoader =
	(fetchImpl: FetchLike = (input, init) => fetch(input, init)): RobotsTxtLoader =>
	async (target) => {
		try {
			const signal = AbortSignal.timeout(ROBOTS_TIMEOUT_MS);
			// Redirects are walked by hand so every hop passes the SSRF guard before it is requested.
			const { response } = await fetchFollowingRedirects(
				(url) =>
					fetchImpl(url, {
						method: "GET",
						redirect: "manual",
						headers: { "user-agent": PLATFORM_USER_AGENT, accept: "text/plain,*/*;q=0.5" },
						signal,
						// Workers-only request options; ignored by other runtimes.
						cf: { cacheTtl: ROBOTS_CACHE_TTL_SECONDS, cacheEverything: true },
					}),
				robotsTxtUrl(target),
			);
			if (!(response.ok && isTextual(response.headers.get("content-type")))) {
				await response.body?.cancel().catch(() => undefined);
				return ALLOW_ALL;
			}
			return parseRobotsTxt(await readTruncated(response.body, MAX_ROBOTS_TXT_BYTES));
		} catch {
			return ALLOW_ALL;
		}
	};
