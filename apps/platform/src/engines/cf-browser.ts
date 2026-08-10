import { launch } from "@cloudflare/playwright";

import { assertPublicHttpUrl } from "../core/ssrf";
import { type EngineFetchParams, type FetchedPage, PlatformError } from "../core/types";
import { FETCH_TIMEOUT_MS, PLATFORM_USER_AGENT } from "./workers-fetch";

/**
 * The `cf-browser` engine: Cloudflare Browser Run via `@cloudflare/playwright`.
 *
 * Runs inside the Worker, so screenshot bytes need no base64 round-trip (unlike the
 * container-hosted `proxy-browser`). No proxy: egress is Cloudflare's.
 */

type BrowserPage = Awaited<ReturnType<Awaited<ReturnType<typeof launch>>["newPage"]>>;

/**
 * `networkidle` renders the most complete DOM but never settles on pages that keep a
 * connection open; a timeout falls back to an explicit `domcontentloaded` navigation.
 */
const gotoWithFallback = async (page: BrowserPage, url: string) => {
	try {
		return await page.goto(url, { waitUntil: "networkidle", timeout: FETCH_TIMEOUT_MS });
	} catch (error) {
		if (!(error instanceof Error && error.name === "TimeoutError")) {
			throw error;
		}
		return await page.goto(url, { waitUntil: "domcontentloaded", timeout: FETCH_TIMEOUT_MS });
	}
};

export const cfBrowserEngine = async (binding: Env["BROWSER"], params: EngineFetchParams): Promise<FetchedPage> => {
	const target = assertPublicHttpUrl(params.url);
	const browser = await launch(binding);

	try {
		const page = await browser.newPage({ userAgent: PLATFORM_USER_AGENT });
		const response = await gotoWithFallback(page, target.href);

		// The browser follows redirects itself, so the landing URL is the only one worth guarding.
		const finalUrl = assertPublicHttpUrl(page.url() || target.href);
		const html = await page.content();
		const screenshot = params.screenshot
			? new Uint8Array(await page.screenshot({ type: "png", fullPage: true }))
			: undefined;

		return { html, url: finalUrl.href, status: response?.status() ?? 200, screenshot };
	} catch (error) {
		if (error instanceof PlatformError) {
			throw error;
		}
		const detail = error instanceof Error ? error.message : String(error);
		throw new PlatformError("fetch_failed", `browser rendering failed for ${target.href}: ${detail}`, 502);
	} finally {
		await browser.close();
	}
};
