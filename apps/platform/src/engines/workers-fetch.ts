import { assertPublicHttpUrl } from "../core/ssrf";
import { type EngineFetchParams, type FetchedPage, PlatformError } from "../core/types";

/**
 * The `fetch` engine: plain Workers `fetch()`, no proxy, no browser.
 *
 * Headers are browser-*shaped* but the User-Agent is honest — we identify as the platform
 * rather than impersonating Chrome. Sites that block us are allowed to block us.
 */
export const PLATFORM_USER_AGENT = "webforai-platform/0.1 (+https://webforai.dev)";

/** Wall clock budget for one page fetch, including redirects. */
export const FETCH_TIMEOUT_MS = 30_000;

/** Hard ceiling on the HTML we will buffer. Larger documents are rejected, never truncated. */
export const MAX_HTML_BYTES = 5 * 1024 * 1024;

export const HTML_REQUEST_HEADERS: Record<string, string> = {
	"user-agent": PLATFORM_USER_AGENT,
	accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"accept-language": "en-US,en;q=0.9",
	"accept-encoding": "gzip, deflate",
};

/**
 * Content types we are willing to convert. Anything else (PDF, images, JSON APIs) is a
 * client mistake, not something to silently feed to the HTML parser.
 */
const isTextualContentType = (contentType: string | null): boolean => {
	if (!contentType) {
		// Servers that omit the header are common enough; we parse the body as HTML and let the
		// conversion decide. This is the one permissive case.
		return true;
	}
	const essence = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	return essence.startsWith("text/") || essence === "application/xhtml+xml" || essence === "application/xml";
};

export const assertTextualContentType = (contentType: string | null): void => {
	if (!isTextualContentType(contentType)) {
		throw new PlatformError("unsupported_content_type", `cannot convert content-type "${contentType}"`, 415);
	}
};

const CHARSET_PATTERN = /charset\s*=\s*"?([\w-]+)"?/i;

/** Honours a declared charset when the runtime knows it; falls back to UTF-8. */
const decodeBody = (bytes: Uint8Array, contentType: string | null): string => {
	const charset = contentType ? CHARSET_PATTERN.exec(contentType)?.[1] : undefined;
	if (charset) {
		try {
			return new TextDecoder(charset).decode(bytes);
		} catch {
			// Unknown label — fall through to UTF-8 rather than failing the whole page.
		}
	}
	return new TextDecoder().decode(bytes);
};

const tooLarge = (): PlatformError =>
	new PlatformError("response_too_large", `response exceeds ${MAX_HTML_BYTES} bytes`, 413);

/** Streams the body, aborting as soon as the cap is crossed so oversized pages cost no memory. */
export const readCappedBytes = async (
	body: ReadableStream<Uint8Array> | null,
	declaredLength: string | null,
	maxBytes: number,
	onTooLarge: () => PlatformError,
): Promise<Uint8Array> => {
	const declared = Number(declaredLength ?? Number.NaN);
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw onTooLarge();
	}
	if (!body) {
		return new Uint8Array(0);
	}

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	let chunk = await reader.read();
	while (!chunk.done) {
		size += chunk.value.byteLength;
		if (size > maxBytes) {
			await reader.cancel();
			throw onTooLarge();
		}
		chunks.push(chunk.value);
		chunk = await reader.read();
	}

	const merged = new Uint8Array(size);
	let offset = 0;
	for (const part of chunks) {
		merged.set(part, offset);
		offset += part.byteLength;
	}
	return merged;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The deployment's own host and its static-assets binding.
 *
 * A Worker cannot `fetch()` a URL on its own zone — Cloudflare answers the looping
 * subrequest with a 522 — so a scrape of our own pages must be served from the assets
 * binding instead. The assets are the same bytes the public URL serves (the prerendered
 * SPA, with its single-page-application fallback), so the result is what any outside
 * fetcher would see.
 */
export interface SelfServing {
	host: string;
	assets: { fetch(input: string): Promise<Response> };
}

export interface WorkersFetchOptions {
	self?: SelfServing;
}

const request = async (url: string, self: SelfServing | undefined): Promise<Response> => {
	try {
		if (self && new URL(url).host === self.host) {
			return await self.assets.fetch(url);
		}
		return await fetch(url, {
			method: "GET",
			redirect: "follow",
			headers: HTML_REQUEST_HEADERS,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch (error) {
		if (error instanceof Error && error.name === "TimeoutError") {
			throw new PlatformError("fetch_failed", `timed out after ${FETCH_TIMEOUT_MS}ms: ${url}`, 504);
		}
		throw new PlatformError("fetch_failed", `request failed: ${describe(error)}`, 502);
	}
};

/**
 * `screenshot` is ignored here: this engine cannot produce one, and `scrape-core` rejects the
 * combination before any engine runs.
 */
export const workersFetchEngine = async (
	{ url }: EngineFetchParams,
	options: WorkersFetchOptions = {},
): Promise<FetchedPage> => {
	const target = assertPublicHttpUrl(url);
	const response = await request(target.href, options.self);

	// Redirects are followed by the runtime, so the only place a private target can appear is
	// the final URL — re-check it before the body is trusted.
	const finalUrl = assertPublicHttpUrl(response.url || target.href);

	if (!response.ok) {
		throw new PlatformError("fetch_failed", `upstream responded ${response.status} for ${finalUrl.href}`, 502);
	}

	const contentType = response.headers.get("content-type");
	assertTextualContentType(contentType);

	const bytes = await readCappedBytes(response.body, response.headers.get("content-length"), MAX_HTML_BYTES, tooLarge);

	return { html: decodeBody(bytes, contentType), url: finalUrl.href, status: response.status };
};
