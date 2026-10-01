import { chromium } from "playwright";
import { ProxyAgent, fetch as undiciFetch } from "undici";

import { nodejsFn } from "../__generated__/create-nodejs-fn.runtime";
import { fetchFollowingRedirects } from "../core/redirects";
import { assertPublicHttpUrl } from "../core/ssrf";
import { PlatformError } from "../core/types";
import { navigate } from "./navigate";
import { captureScreenshot, guardPageRequests, readPageHtml, withRenderDeadline } from "./page-guard";
import { buildProxyUsername } from "./proxy-username";
import { FETCH_TIMEOUT_MS, HTML_REQUEST_HEADERS, MAX_HTML_BYTES, PLATFORM_USER_AGENT } from "./workers-fetch";

/**
 * Node.js functions executed inside a Cloudflare Container (create-nodejs-fn).
 *
 * Workers `fetch()` cannot egress through a third-party proxy and cannot run Playwright, so
 * both proxied engines live here. Everything crossing the RPC boundary must be plain JSON:
 * screenshots are returned as base64 strings, never `Uint8Array`.
 *
 * Errors also cross that boundary, and only the message survives. Failures are therefore
 * encoded as `"<code>: <message>"`; `engines/index.ts` maps the code back to a `PlatformError`
 * with the right HTTP status. Do not throw bare errors from these functions.
 */

/** Error codes understood by `engines/index.ts`. Keep the two files in sync. */
export type ContainerErrorCode =
	| "invalid_url"
	| "fetch_failed"
	| "unsupported_content_type"
	| "response_too_large"
	| "engine_unavailable";

const containerError = (code: ContainerErrorCode, message: string): Error => new Error(`${code}: ${message}`);

/**
 * The container has no typed `Env`; create-nodejs-fn forwards the worker vars listed in
 * `vite.config.ts` (`workerEnvVars`) as real process env. Read through `globalThis` so this
 * module type-checks in the Worker's DOM-only lib set.
 */
const readEnv = (name: string): string | undefined =>
	(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];

/**
 * The rotating-proxy gateway rotates the egress IP per request when the username carries the
 * `-rotate` suffix, and pins it to a country when the username carries `-{CC}-rotate`.
 *
 * The country arrives as a plain ISO code because everything crossing the container RPC boundary
 * must be serialisable — the Worker resolves the API's coarse region to a code (`core/regions.ts`)
 * so the container never imports `core/`.
 */
const proxyConfig = (country?: string): { server: string; username: string; password: string } => {
	const server = readEnv("PROXY_URL");
	const username = readEnv("PROXY_USERNAME");
	const password = readEnv("PROXY_PASSWORD");
	if (!(server && username && password)) {
		throw containerError("engine_unavailable", "proxy settings are not present in the container environment");
	}
	return { server, username: buildProxyUsername(username, country), password };
};

/**
 * Re-runs the shared SSRF guard (a pure module, so it bundles into the container image) and
 * converts its `PlatformError` into the wire format described above.
 */
const assertAllowedUrl = (raw: string): string => {
	try {
		return assertPublicHttpUrl(raw).href;
	} catch (error) {
		throw containerError("invalid_url", error instanceof Error ? error.message : String(error));
	}
};

const assertTextual = (contentType: string | null): void => {
	if (!contentType) {
		return;
	}
	const essence = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	if (!(essence.startsWith("text/") || essence === "application/xhtml+xml" || essence === "application/xml")) {
		throw containerError("unsupported_content_type", `cannot convert content-type "${contentType}"`);
	}
};

/** Streaming read with the same 5 MiB ceiling as the Workers engine; oversized pages fail. */
const readCappedText = async (body: ReadableStream<Uint8Array> | null): Promise<string> => {
	if (!body) {
		return "";
	}
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	let chunk = await reader.read();
	while (!chunk.done) {
		size += chunk.value.byteLength;
		if (size > MAX_HTML_BYTES) {
			await reader.cancel();
			throw containerError("response_too_large", `response exceeds ${MAX_HTML_BYTES} bytes`);
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
	return new TextDecoder().decode(merged);
};

export interface ProxyFetchResult {
	html: string;
	finalUrl: string;
	status: number;
}

export interface ProxyBrowserResult extends ProxyFetchResult {
	/** Full-page PNG, base64-encoded because RPC returns must be plain-serializable. */
	screenshotBase64?: string;
}

/**
 * `proxy-fetch` engine: undici through the rotating HTTP proxy configured via `PROXY_URL`.
 *
 * `country` is an ISO 3166-1 alpha-2 code or `undefined` for no geo-targeting.
 */
export const proxyFetch = nodejsFn(async (url: string, country?: string): Promise<ProxyFetchResult> => {
	const target = assertAllowedUrl(url);
	const { server, username, password } = proxyConfig(country);
	const gateway = new URL(server);
	const proxyUri = `${gateway.protocol}//${encodeURIComponent(username)}:${encodeURIComponent(password)}@${
		gateway.host
	}`;
	const agent = new ProxyAgent(proxyUri);

	try {
		// One budget for the whole chain; redirects are walked by hand so every hop is checked.
		const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
		const { response, url: finalUrl } = await fetchFollowingRedirects(
			(hop) =>
				undiciFetch(hop, {
					method: "GET",
					redirect: "manual",
					headers: HTML_REQUEST_HEADERS,
					dispatcher: agent,
					signal,
				}),
			target,
			{ assertUrl: assertAllowedUrl },
		);
		if (!response.ok) {
			throw containerError("fetch_failed", `upstream responded ${response.status} for ${finalUrl}`);
		}
		assertTextual(response.headers.get("content-type"));

		// undici types its body with the Node `stream/web` ReadableStream; structurally identical
		// to the DOM one this file is checked against.
		const html = await readCappedText(response.body as unknown as ReadableStream<Uint8Array> | null);
		return { html, finalUrl, status: response.status };
	} catch (error) {
		throw normalizeFailure(error, target);
	} finally {
		await agent.close();
	}
});

/**
 * Resource types that never reach the Markdown: image and media URLs are read from the DOM
 * (`src`, `srcset`, `data-src` stay intact when the request is aborted) and fonts only change
 * rendering. Every byte here is paid proxy bandwidth, so they are aborted unless a screenshot
 * needs the page to look right.
 */
const UNUSED_RESOURCE_TYPES: ReadonlySet<string> = new Set(["image", "media", "font"]);

/** `proxy-browser` engine: Playwright Chromium behind the same rotating proxy. */
export const proxyBrowser = nodejsFn(
	async (url: string, screenshot: boolean, country?: string): Promise<ProxyBrowserResult> => {
		const target = assertAllowedUrl(url);
		const { server, username, password } = proxyConfig(country);
		const browser = await chromium.launch({
			headless: true,
			proxy: { server, username, password },
		});

		try {
			return await withRenderDeadline(async () => {
				// Service workers would fetch outside request interception. Loopback is not a bypass:
				// Playwright forces it through the configured proxy, like every other request.
				const page = await browser.newPage({ userAgent: PLATFORM_USER_AGENT, serviceWorkers: "block" });
				const guard = await guardPageRequests(page, screenshot ? {} : { blockResourceTypes: UNUSED_RESOURCE_TYPES });
				const response = await navigate(page, target, FETCH_TIMEOUT_MS);
				guard.assertClean();
				const finalUrl = assertAllowedUrl(page.url() || target);
				const html = await readPageHtml(page);
				const screenshotBase64 = screenshot ? (await captureScreenshot(page)).toString("base64") : undefined;

				return { html, finalUrl, status: response?.status() ?? 200, screenshotBase64 };
			});
		} catch (error) {
			throw normalizeFailure(error, target);
		} finally {
			await browser.close();
		}
	},
);

const CODED_MESSAGE = /^[a-z_]+: /;

/** Leaves already-coded errors alone; everything else becomes a `fetch_failed`. */
const normalizeFailure = (error: unknown, url: string): Error => {
	if (error instanceof Error && CODED_MESSAGE.test(error.message)) {
		return error;
	}
	// The shared guards (redirect walker, page guard) throw `PlatformError`s with codes from the
	// same vocabulary; re-encode them for the RPC boundary.
	if (error instanceof PlatformError) {
		return containerError(error.code as ContainerErrorCode, error.message);
	}
	const detail = error instanceof Error ? error.message : String(error);
	return containerError("fetch_failed", `${url}: ${detail}`);
};
