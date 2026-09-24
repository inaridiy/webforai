import { launch } from "@cloudflare/playwright";

import { assertPublicHttpUrl } from "../core/ssrf";
import { type EngineFetchParams, type FetchedPage, PlatformError } from "../core/types";
import { navigate } from "./navigate";
import { FETCH_TIMEOUT_MS, PLATFORM_USER_AGENT } from "./workers-fetch";

/**
 * The `browser` engine: managed browser rendering via `@cloudflare/playwright`.
 *
 * Runs inside the Worker, so screenshot bytes need no base64 round-trip (unlike the
 * container-hosted `proxy-browser`). No proxy: egress is Cloudflare's.
 */

/*
 * Resources are not blocked here (unlike `proxy-browser`): Browser Rendering bandwidth is not
 * billed, and `page.route` would add a Worker round-trip per subresource.
 */

export const browserEngine = async (binding: Env["BROWSER"], params: EngineFetchParams): Promise<FetchedPage> => {
	const target = assertPublicHttpUrl(params.url);
	const browser = await launch(binding);

	try {
		const page = await browser.newPage({ userAgent: PLATFORM_USER_AGENT });
		const response = await navigate(page, target.href, FETCH_TIMEOUT_MS);

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
