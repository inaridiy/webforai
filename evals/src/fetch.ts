import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { type Browser, chromium } from "playwright-core";
import { ProxyAgent, fetch as undiciFetch } from "undici";

import { CACHE_DIR, USER_AGENT } from "./config.js";
import { ProxyPool, loadProxies } from "./proxy.js";

export type RenderMode = "static" | "rendered";

const HTML_CACHE_DIR = path.join(CACHE_DIR, "html");

/** Cache key. The URL hash keeps filenames short and safe while staying stable across runs. */
const cachePath = (id: string, mode: RenderMode, url: string): string => {
	const digest = createHash("sha1").update(url).digest("hex").slice(0, 8);
	return path.join(HTML_CACHE_DIR, `${id}.${mode}.${digest}.html`);
};

export const readCached = async (id: string, mode: RenderMode, url: string): Promise<string | undefined> => {
	try {
		return await readFile(cachePath(id, mode, url), "utf-8");
	} catch {
		return undefined;
	}
};

export const isCached = async (id: string, mode: RenderMode, url: string): Promise<boolean> => {
	try {
		const stats = await stat(cachePath(id, mode, url));
		return stats.size > 0;
	} catch {
		return false;
	}
};

const writeCached = async (id: string, mode: RenderMode, url: string, html: string): Promise<void> => {
	await mkdir(HTML_CACHE_DIR, { recursive: true });
	await writeFile(cachePath(id, mode, url), html);
};

/**
 * Request headers for corpus fetching.
 *
 * Deliberately minimal. `accept-encoding` is *not* set: letting the client negotiate means the
 * response is transparently decompressed, whereas naming brotli explicitly and reading the body
 * as text yields corrupted bytes. The extra `sec-fetch-*` headers were also removed after
 * several publishers answered 403 to the fuller header set but 200 to this one.
 */
const BROWSER_HEADERS = {
	"user-agent": USER_AGENT,
	accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
	"accept-language": "en-US,en;q=0.9,ja;q=0.8",
} as const;

export interface FetchOptions {
	/** Re-fetch even when a cached copy exists. */
	force?: boolean;
	/** How many proxies to try before giving up on a page. */
	attempts?: number;
	timeoutMs?: number;
}

/**
 * Fetches the server-rendered HTML, rotating through the proxy pool on failure.
 *
 * Publishers commonly serve a challenge page or a 403 to datacenter egress, so a failed attempt
 * retries from a different exit IP rather than aborting the whole corpus run.
 */
export const fetchStatic = async (
	site: { id: string; url: string },
	pool: ProxyPool,
	options: FetchOptions = {},
): Promise<string> => {
	const { force = false, attempts = 4, timeoutMs = 30_000 } = options;

	if (!force) {
		const cached = await readCached(site.id, "static", site.url);
		if (cached) {
			return cached;
		}
	}

	const errors: string[] = [];
	const hostname = new URL(site.url).hostname;

	for (let attempt = 0; attempt < attempts; attempt++) {
		// Attempt 0 goes out directly: it is faster and, for most publishers, more reliable than
		// a datacenter proxy. The pool is only there to route around per-IP blocks.
		const proxy = attempt === 0 ? undefined : pool.next();
		// `servername` must be pinned to the target host and TLS session caching disabled.
		// undici caches sessions per proxy socket, so without this the second host fetched in a
		// process is validated against the first host's certificate and always fails.
		const agent = proxy
			? new ProxyAgent({ uri: proxy.url, requestTls: { servername: hostname, maxCachedSessions: 0 } })
			: undefined;

		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), timeoutMs);

		try {
			const response = await undiciFetch(site.url, {
				headers: BROWSER_HEADERS,
				redirect: "follow",
				signal: abort.signal,
				dispatcher: agent,
			});

			const html = await response.text();

			if (response.status >= 400) {
				errors.push(`${proxy?.label ?? "direct"}: HTTP ${response.status}`);
				if (proxy) {
					pool.reportFailure(proxy);
				}
				continue;
			}
			if (html.trim().length === 0) {
				errors.push(`${proxy?.label ?? "direct"}: empty body`);
				continue;
			}

			if (proxy) {
				pool.reportSuccess(proxy);
			}
			await writeCached(site.id, "static", site.url, html);
			return html;
		} catch (error) {
			errors.push(`${proxy?.label ?? "direct"}: ${(error as Error).message}`);
			if (proxy) {
				pool.reportFailure(proxy);
			}
		} finally {
			clearTimeout(timer);
			await agent?.close().catch(() => undefined);
		}
	}

	throw new Error(`Failed to fetch ${site.url} after ${attempts} attempts:\n  ${errors.join("\n  ")}`);
};

/**
 * Annotates every element with its rendered box so the extractor can use visual size.
 *
 * Runs inside the page because layout information only exists in a live document. Elements that
 * the browser laid out at zero size are almost always collapsed menus or offscreen boilerplate.
 */
const ANNOTATE_LAYOUT = `() => {
	for (const element of document.querySelectorAll("*")) {
		const rect = element.getBoundingClientRect();
		element.setAttribute("data-rwidth", String(Math.round(rect.width)));
		element.setAttribute("data-rheight", String(Math.round(rect.height)));
	}
}`;

export const fetchRendered = async (
	site: { id: string; url: string },
	pool: ProxyPool,
	browserRef: { browser?: Browser },
	options: FetchOptions = {},
): Promise<string> => {
	const { force = false, attempts = 3, timeoutMs = 45_000 } = options;

	if (!force) {
		const cached = await readCached(site.id, "rendered", site.url);
		if (cached) {
			return cached;
		}
	}

	const errors: string[] = [];

	for (let attempt = 0; attempt < attempts; attempt++) {
		// As in `fetchStatic`, try the direct route before spending a proxy on the page.
		const proxy = attempt === 0 ? undefined : pool.next();

		if (!browserRef.browser) {
			browserRef.browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
		}

		const context = await browserRef.browser.newContext({
			userAgent: USER_AGENT,
			viewport: { width: 1440, height: 900 },
			locale: "en-US",
			proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
		});

		try {
			const page = await context.newPage();
			await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
			// `networkidle` never settles on pages with long-polling, so cap the extra settle time.
			await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
			await page.evaluate(ANNOTATE_LAYOUT);

			const html = await page.content();
			if (html.trim().length === 0) {
				throw new Error("empty document");
			}

			if (proxy) {
				pool.reportSuccess(proxy);
			}
			await writeCached(site.id, "rendered", site.url, html);
			return html;
		} catch (error) {
			errors.push(`${proxy?.label ?? "direct"}: ${(error as Error).message}`);
			if (proxy) {
				pool.reportFailure(proxy);
			}
		} finally {
			await context.close().catch(() => undefined);
		}
	}

	throw new Error(`Failed to render ${site.url} after ${attempts} attempts:\n  ${errors.join("\n  ")}`);
};

export const createPool = async (): Promise<ProxyPool> => new ProxyPool(await loadProxies());
