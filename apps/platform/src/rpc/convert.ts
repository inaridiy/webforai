import { z } from "zod";

import { extractPageLinks } from "../core/links";
import { type ScrapeDeps, convertFetchedPage, fetchForScrape } from "../core/scrape-core";
import { PlatformError, type ScrapeRequest } from "../core/types";
import { type RateLimiter, checkRateLimit } from "../ops/limits";
import { MAX_URL_LENGTH } from "../routes/schemas";

/**
 * The internal conversion service behind `PlatformRpc` (a `WorkerEntrypoint` reached only
 * through a Service Binding from Workers on this account — the binding is the credential).
 *
 * Deliberately outside the public product: no API key, tier limit, spend guard, usage ledger or
 * Stripe. What it keeps is everything that protects shared resources and the network: the SSRF
 * guard and redirect walk (inside the engines), Browser Run's concurrency (shared with public
 * traffic), and one internal Rate Limiting binding keyed by tenant. Proxy engines are not
 * offered, so the paid proxy bandwidth is never spent here.
 */

export const RPC_ENGINES = ["auto", "fetch", "browser"] as const;
export const RPC_FORMATS = ["markdown", "links"] as const;

export const convertOptionsSchema = z
	.object({
		/** Who is calling, for logs and the per-tenant limit ("shadcn-explorer"). */
		tenant: z
			.string()
			.min(1)
			.max(64)
			.regex(/^[a-z0-9][a-z0-9._-]*$/i),
		formats: z.array(z.enum(RPC_FORMATS)).min(1).max(RPC_FORMATS.length).default(["markdown"]),
		extractor: z.enum(["auto", "takumi", "minimal", "none"]).optional(),
		engine: z.enum(RPC_ENGINES).default("auto"),
	})
	.strict();

export type ConvertOptions = z.input<typeof convertOptionsSchema>;

export interface ConvertResult {
	/** The final URL after redirects. */
	url: string;
	/** Empty when `formats` omits "markdown". */
	markdown: string;
	/** Every http(s) link on the page, absolute, when `formats` includes "links". */
	links?: string[];
	metadata?: Record<string, unknown>;
	/** The concrete engine that produced the page (`auto` resolved). */
	engine: string;
	warning?: string;
}

export interface RpcConvertDeps {
	scrape: ScrapeDeps;
	/** `RATE_LIMIT_INTERNAL`; absent means unlimited (warned once by `checkRateLimit`). */
	limiter: RateLimiter | undefined;
	log?: Pick<Console, "info" | "warn">;
	now?: () => number;
}

/**
 * Workers RPC keeps an Error's `message` across the binding but not custom properties, so the
 * machine-readable code travels as a `code: message` prefix (the same convention the container
 * RPC uses).
 */
export class PlatformRpcError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(`${code}: ${message}`);
		this.name = "PlatformRpcError";
	}
}

const parseInput = (
	url: unknown,
	options: unknown,
): { url: string; options: z.output<typeof convertOptionsSchema> } => {
	const parsedUrl = z.string().max(MAX_URL_LENGTH).url().safeParse(url);
	const parsedOptions = convertOptionsSchema.safeParse(options ?? {});
	if (!(parsedUrl.success && parsedOptions.success)) {
		const issue = parsedUrl.success ? parsedOptions.error?.issues[0] : parsedUrl.error.issues[0];
		throw new PlatformRpcError("invalid_request", `${issue?.path.join(".") || "url"}: ${issue?.message ?? "invalid"}`);
	}
	return { url: parsedUrl.data, options: parsedOptions.data };
};

export const rpcConvert = async (
	deps: RpcConvertDeps,
	rawUrl: unknown,
	rawOptions: unknown,
): Promise<ConvertResult> => {
	const { url, options } = parseInput(rawUrl, rawOptions);
	const log = deps.log ?? console;
	const started = (deps.now ?? Date.now)();

	if (!(await checkRateLimit(deps.limiter, { binding: "RATE_LIMIT_INTERNAL", key: options.tenant }))) {
		throw new PlatformRpcError(
			"rate_limited",
			`internal limit reached for tenant "${options.tenant}"; retry in a minute`,
		);
	}

	const request: ScrapeRequest = {
		url,
		engine: options.engine,
		screenshot: false,
		rehostImages: false,
		convert: options.extractor ? { extractor: options.extractor } : {},
	};
	try {
		const page = await fetchForScrape(deps.scrape, request);
		const wantsMarkdown = options.formats.includes("markdown");
		const converted = wantsMarkdown ? await convertFetchedPage(deps.scrape, request, page) : undefined;
		const result: ConvertResult = {
			url: page.url,
			markdown: converted?.markdown ?? "",
			engine: page.engine,
			...(converted ? { metadata: converted.metadata } : {}),
			...(options.formats.includes("links") ? { links: extractPageLinks(page.html, page.url) } : {}),
			...(page.warning === undefined ? {} : { warning: page.warning }),
		};
		log.info("rpc_convert", { tenant: options.tenant, engine: page.engine, ms: (deps.now ?? Date.now)() - started });
		return result;
	} catch (error) {
		log.warn("rpc_convert_failed", { tenant: options.tenant, url, error: String(error) });
		if (error instanceof PlatformError) {
			throw new PlatformRpcError(error.code, error.message);
		}
		throw new PlatformRpcError("internal_error", error instanceof Error ? error.message : String(error));
	}
};
