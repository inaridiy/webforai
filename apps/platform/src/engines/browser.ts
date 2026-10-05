import { launch } from "@cloudflare/playwright";

import { assertPublicHttpUrl } from "../core/ssrf";
import { type EngineFetchParams, type FetchedPage, PlatformError } from "../core/types";
import { navigate } from "./navigate";
import { captureScreenshot, guardPageRequests, readPageHtml, withRenderDeadline } from "./page-guard";
import { FETCH_TIMEOUT_MS, PLATFORM_USER_AGENT } from "./workers-fetch";

/**
 * The `browser` engine: managed browser rendering via `@cloudflare/playwright`.
 *
 * Runs inside the Worker, so screenshot bytes need no base64 round-trip (unlike the
 * container-hosted `proxy-browser`). No proxy: egress is Cloudflare's.
 */

/*
 * Resource *types* are not blocked here (unlike `proxy-browser`): Browser Rendering bandwidth is
 * not billed. Every request is still routed through the SSRF guard (`page-guard.ts`), which
 * costs a Worker round-trip per subresource — the price of not letting a page point the
 * browser at private addresses.
 */

export const browserEngine = async (binding: Env["BROWSER"], params: EngineFetchParams): Promise<FetchedPage> => {
	const target = assertPublicHttpUrl(params.url);
	const browser = await launch(binding);

	try {
		return await withRenderDeadline(async () => {
			// Service workers would fetch outside request interception.
			const page = await browser.newPage({ userAgent: PLATFORM_USER_AGENT, serviceWorkers: "block" });
			const guard = await guardPageRequests(page);
			const { response, settled } = await navigate(page, target.href, FETCH_TIMEOUT_MS);

			guard.assertClean();
			const finalUrl = assertPublicHttpUrl(page.url() || target.href);
			const html = await readPageHtml(page);
			const screenshot = params.screenshot ? new Uint8Array(await captureScreenshot(page)) : undefined;

			return {
				html,
				url: finalUrl.href,
				status: response?.status() ?? 200,
				screenshot,
				...(settled ? {} : { renderTimedOut: true }),
			};
		});
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
