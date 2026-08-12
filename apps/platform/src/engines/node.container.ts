import type { Page } from "playwright";
import { chromium } from "playwright";
import { ProxyAgent, fetch as undiciFetch } from "undici";

import { nodejsFn } from "../__generated__/create-nodejs-fn.runtime";
import { assertPublicHttpUrl } from "../core/ssrf";
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

const WEBSHARE_PROXY_SERVER = "http://p.webshare.io:80";

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
 * Webshare rotates the egress IP per request when the username carries the `-rotate` suffix, and
 * pins it to a country when the username carries `-{CC}-rotate`.
 *
 * The country arrives as a plain ISO code because everything crossing the container RPC boundary
 * must be serialisable — the Worker resolves the API's coarse region to a code (`core/regions.ts`)
 * so the container never imports `core/`.
 */
const proxyCredentials = (country?: string): { username: string; password: string } => {
	const username = readEnv("WEBSHARE_PROXY_USERNAME");
	const password = readEnv("WEBSHARE_PROXY_PASSWORD");
	if (!(username && password)) {
		throw containerError("engine_unavailable", "Webshare credentials are not present in the container environment");
	}
	return { username: buildProxyUsername(username, country), password };
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
 * `proxy-fetch` engine: undici through the Webshare rotating HTTP proxy.
 *
 * `country` is an ISO 3166-1 alpha-2 code or `undefined` for no geo-targeting.
 */
export const proxyFetch = nodejsFn(async (url: string, country?: string): Promise<ProxyFetchResult> => {
	const target = assertAllowedUrl(url);
	const { username, password } = proxyCredentials(country);
	const proxyUri = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@p.webshare.io:80`;
	const agent = new ProxyAgent(proxyUri);

	try {
		const response = await undiciFetch(target, {
			method: "GET",
			redirect: "follow",
			headers: HTML_REQUEST_HEADERS,
			dispatcher: agent,
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});

		const finalUrl = assertAllowedUrl(response.url || target);
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
 * `networkidle` gives the best-rendered DOM but never settles on pages with long-polling or
 * analytics beacons, so a timeout falls back to `domcontentloaded` — a second, explicit
 * navigation rather than a silent partial result.
 */
const gotoWithFallback = async (page: Page, url: string) => {
	try {
		return await page.goto(url, { waitUntil: "networkidle", timeout: FETCH_TIMEOUT_MS });
	} catch (error) {
		if (!(error instanceof Error && error.name === "TimeoutError")) {
			throw error;
		}
		return await page.goto(url, { waitUntil: "domcontentloaded", timeout: FETCH_TIMEOUT_MS });
	}
};

/** `proxy-browser` engine: Playwright Chromium behind the same Webshare proxy. */
export const proxyBrowser = nodejsFn(
	async (url: string, screenshot: boolean, country?: string): Promise<ProxyBrowserResult> => {
		const target = assertAllowedUrl(url);
		const { username, password } = proxyCredentials(country);
		const browser = await chromium.launch({
			headless: true,
			proxy: { server: WEBSHARE_PROXY_SERVER, username, password },
		});

		try {
			const page = await browser.newPage({ userAgent: PLATFORM_USER_AGENT });
			const response = await gotoWithFallback(page, target);
			const finalUrl = assertAllowedUrl(page.url() || target);
			const html = await page.content();
			const screenshotBase64 = screenshot
				? (await page.screenshot({ type: "png", fullPage: true })).toString("base64")
				: undefined;

			return { html, finalUrl, status: response?.status() ?? 200, screenshotBase64 };
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
	const detail = error instanceof Error ? error.message : String(error);
	return containerError("fetch_failed", `${url}: ${detail}`);
};
