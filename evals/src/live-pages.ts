/**
 * Live pages for the link benchmarks: rendered in headless Chromium, through the proxy pool, one
 * request at a time per host, cached with `readPage`/`writePage` (failures included).
 *
 * Requests go through the proxy pool (`WEBFORAI_PROXY_LIST_URL` / `WEBFORAI_PROXY_URL`, see
 * `config.ts`): up to three proxies per page, a failed or blocked (HTTP 403/429) answer moving on to
 * the next. `direct` fetches from this machine instead; without a configured proxy it throws.
 * `WEBWALKER_CHROMIUM` points at a Chromium binary when playwright-core's own is not installed.
 */

import { type Browser, chromium } from "playwright-core";

import { USER_AGENT } from "./config.js";
import { type Proxy as PoolProxy, ProxyPool, loadProxies } from "./proxy.js";
import { type CachedPage, readPage, writePage } from "./webwalker.js";

/** Proxies tried per page before it is recorded as failed. */
const PROXY_ATTEMPTS = 3;
/** Pages open at once, across hosts. */
const MAX_OPEN = 6;

/** A failure another exit IP may get past: no response, or a block. */
export const blocked = (page: CachedPage): boolean => page.status === 0 || page.status === 403 || page.status === 429;

export interface PageFetcher {
	/** The cached page, or the page rendered now (and cached). */
	get: (url: string) => Promise<CachedPage>;
	close: () => Promise<void>;
}

export const createPageFetcher = async ({ direct = false } = {}): Promise<PageFetcher> => {
	const pool = direct ? undefined : new ProxyPool(await loadProxies());
	if (pool && pool.size === 0) {
		throw new Error(
			"No proxy configured (WEBFORAI_PROXY_LIST_URL or WEBFORAI_PROXY_URL); pass --direct to fetch without one",
		);
	}

	// One request at a time per host, with a pause.
	const hostQueues = new Map<string, Promise<unknown>>();
	const politely = <T>(url: string, task: () => Promise<T>): Promise<T> => {
		const host = new URL(url).hostname;
		const previous = hostQueues.get(host) ?? Promise.resolve();
		const next = previous.then(
			() => task().finally(() => new Promise((resolve) => setTimeout(resolve, 500))),
			() => task(),
		);
		hostQueues.set(
			host,
			next.catch(() => undefined),
		);
		return next;
	};

	let browser: Promise<Browser> | undefined;
	let open = 0;
	const waiting: (() => void)[] = [];
	const slot = async (): Promise<() => void> => {
		if (open >= MAX_OPEN) {
			await new Promise<void>((resolve) => waiting.push(resolve));
		}
		open += 1;
		return () => {
			open -= 1;
			waiting.shift()?.();
		};
	};

	const render = async (url: string, proxy?: PoolProxy): Promise<CachedPage> => {
		browser ??= chromium.launch({
			headless: true,
			executablePath: process.env.WEBWALKER_CHROMIUM,
			args: ["--no-sandbox"],
		});
		const release = await slot();
		const context = await (await browser).newContext({
			userAgent: USER_AGENT,
			viewport: { width: 1440, height: 900 },
			locale: "en-US",
			proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
		});
		try {
			const page = await context.newPage();
			const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
			const contentType = (await response?.headerValue("content-type")) ?? "";
			if (!contentType.includes("html")) {
				return { url, finalUrl: page.url(), status: response?.status() ?? 0, contentType, html: "" };
			}
			// `networkidle` never settles on pages with long-polling, so cap the extra settle time.
			await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
			return { url, finalUrl: page.url(), status: response?.status() ?? 0, contentType, html: await page.content() };
		} catch (error) {
			return {
				url,
				finalUrl: url,
				status: 0,
				contentType: "",
				html: "",
				error: (error as Error).message.split("\n")[0],
			};
		} finally {
			await context.close().catch(() => undefined);
			release();
		}
	};

	const get = async (url: string): Promise<CachedPage> => {
		const cached = await readPage(url);
		if (cached) {
			return cached;
		}
		return politely(url, async () => {
			let page: CachedPage | undefined;
			for (let attempt = 0; attempt < (pool ? PROXY_ATTEMPTS : 1) && (!page || blocked(page)); attempt++) {
				const proxy = pool?.next();
				page = await render(url, proxy);
				if (proxy) {
					blocked(page) ? pool?.reportFailure(proxy) : pool?.reportSuccess(proxy);
				}
			}
			page ??= await render(url);
			page = { ...page, fetchedAt: new Date().toISOString() };
			await writePage(page);
			return page;
		});
	};

	return { get, close: async () => (await browser)?.close() };
};
