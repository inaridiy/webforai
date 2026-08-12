import { regionToCountry } from "../core/regions";
import {
	type Engine,
	type EngineFetchParams,
	type EngineSet,
	EngineUnavailableError,
	type FetchedPage,
	PlatformError,
} from "../core/types";
import type { AppConfig } from "../env";
import { cfBrowserEngine } from "./cf-browser";
import { proxyBrowser, proxyFetch } from "./node.container";
import { workersFetchEngine } from "./workers-fetch";

/**
 * Composition root for HTML acquisition.
 *
 * Every engine either produces a page or throws; there is no fallback between engines. A
 * caller that asked for `proxy-browser` and got a `fetch` result would be silently billed for
 * a different product than it received.
 */

/** Codes the container functions encode into their error messages, and the status they map to. */
const CONTAINER_ERROR_STATUS = new Map<string, number>([
	["invalid_url", 400],
	["unsupported_content_type", 415],
	["response_too_large", 413],
	["fetch_failed", 502],
]);

const CODED_MESSAGE = /^([a-z_]+): ([\s\S]*)$/;

/** Rebuilds a typed `PlatformError` from the flattened message that survives container RPC. */
const fromContainerError = (engine: Engine, error: unknown): PlatformError => {
	if (error instanceof PlatformError) {
		return error;
	}
	const message = error instanceof Error ? error.message : String(error);
	const match = CODED_MESSAGE.exec(message);
	const code = match?.[1];
	const detail = match?.[2] ?? message;

	if (code === "engine_unavailable") {
		return new EngineUnavailableError(engine, detail);
	}
	const status = code === undefined ? undefined : CONTAINER_ERROR_STATUS.get(code);
	if (code !== undefined && status !== undefined) {
		return new PlatformError(code, detail, status);
	}
	return new PlatformError("engine_failed", `engine "${engine}" failed: ${message}`, 502);
};

const callContainer = async <T>(engine: Engine, run: () => Promise<T>): Promise<T> => {
	try {
		return await run();
	} catch (error) {
		throw fromContainerError(engine, error);
	}
};

const requireProxy = (config: AppConfig, engine: Engine): void => {
	if (!config.proxyEnabled) {
		throw new EngineUnavailableError(engine, "WEBSHARE_PROXY_USERNAME/PASSWORD are not configured");
	}
};

const decodeBase64 = (value: string): Uint8Array => {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
};

/**
 * The API's coarse region resolved to the ISO code Webshare wants. Done Worker-side so the
 * container never imports `core/`, and so `auto` (the default) crosses the RPC as `undefined`.
 */
const countryFor = (region: EngineFetchParams["region"]): string | undefined => regionToCountry(region ?? "auto");

export const createEngines = (env: Env, config: AppConfig): EngineSet => ({
	// `fetch` and `cf-browser` egress from Cloudflare and cannot be geo-targeted, so they ignore
	// `region` rather than silently pretending to honour it.
	fetch: workersFetchEngine,

	"proxy-fetch": async ({ url, region }): Promise<FetchedPage> => {
		requireProxy(config, "proxy-fetch");
		const page = await callContainer("proxy-fetch", () => proxyFetch(url, countryFor(region)));
		return { html: page.html, url: page.finalUrl, status: page.status };
	},

	// `screenshot` is honoured here; `scrape-core` rejects it for the two engines that cannot
	// produce one, so the flag never reaches them.
	"proxy-browser": async ({ url, screenshot, region }): Promise<FetchedPage> => {
		requireProxy(config, "proxy-browser");
		const page = await callContainer("proxy-browser", () => proxyBrowser(url, screenshot, countryFor(region)));
		return {
			html: page.html,
			url: page.finalUrl,
			status: page.status,
			screenshot: page.screenshotBase64 ? decodeBase64(page.screenshotBase64) : undefined,
		};
	},

	"cf-browser": (params) => cfBrowserEngine(env.BROWSER, params),
});
