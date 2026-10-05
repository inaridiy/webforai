import type { PageMetadata } from "webforai";
import {
	EXTRACTOR_PRESETS,
	RPC_ENGINES,
	RPC_FORMATS,
	type RpcConvertError,
	type RpcConvertOptions,
	type RpcConvertOutcome,
	type RpcConvertResult,
	type RpcErrorCode,
	type RpcPageMetadata,
	type RpcWarning,
} from "webforai/platform";
import { z } from "zod";

import { extractPageLinks } from "../core/links";
import { resolveImageUrl } from "../core/rehost";
import { type ScrapeDeps, convertFetchedPage, fetchForScrape } from "../core/scrape-core";
import { EscalationExhaustedError, PlatformError, type ScrapeRequest } from "../core/types";
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
 *
 * The wire types are `webforai/platform`'s `Rpc*` types; this module implements them, so the
 * published types cannot drift from the deployment.
 */

/**
 * Unknown keys are dropped rather than refused, so a client built against a newer contract can
 * still call an older deployment; known keys are validated as strictly as ever.
 */
export const convertOptionsSchema = z.object({
	/** Who is calling, for logs and the per-tenant limit ("shadcn-explorer", "rebabel-prod"). */
	tenant: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[a-z0-9][a-z0-9._-]*$/i),
	formats: z.array(z.enum(RPC_FORMATS)).min(1).max(RPC_FORMATS.length).default(["markdown"]),
	extractor: z.enum(EXTRACTOR_PRESETS).optional(),
	engine: z.enum(RPC_ENGINES).default("auto"),
	frontmatter: z.boolean().default(true),
	titleHeading: z.boolean().default(true),
});

export type ConvertOptions = RpcConvertOptions;
export type ConvertResult = RpcConvertResult;

export interface RpcConvertDeps {
	scrape: ScrapeDeps;
	/** `RATE_LIMIT_INTERNAL`; absent means unlimited (warned once by `checkRateLimit`). */
	limiter: RateLimiter | undefined;
	log?: Pick<Console, "info" | "warn">;
	now?: () => number;
}

/**
 * Workers RPC keeps an Error's `message` across the binding but not custom properties, so
 * `convert` sends the machine-readable code as a `code: message` prefix (the same convention the
 * container RPC uses). `tryConvert` returns the structured error instead.
 */
export class PlatformRpcError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		// The default `Error` name on purpose: Workers RPC folds a custom name into the message
		// (`PlatformRpcError: code: …`), which would break the `code: message` convention.
		super(`${code}: ${message}`);
	}
}

/** A failure already shaped for the wire; thrown inside this module, returned by `tryConvert`. */
class RpcFailure extends Error {
	constructor(readonly error: RpcConvertError) {
		super(error.message);
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
		throw new RpcFailure({
			code: "invalid_request",
			message: `${issue?.path.join(".") || "url"}: ${issue?.message ?? "invalid"}`,
			retryable: false,
		});
	}
	return { url: parsedUrl.data, options: parsedOptions.data };
};

/** Both fetch engines phrase upstream refusals this way (see `scrape-core.ts`). */
const UPSTREAM_STATUS = /upstream responded (\d{3})\b/;
const CONTENT_TYPE = /cannot convert content-type "([^"]*)"/;

/** Upstream statuses a later attempt can plausibly get past: timeouts and throttling. */
const TRANSIENT_CLIENT_STATUS = new Set([408, 425, 429]);

const toRpcError = (error: unknown): RpcConvertError => {
	if (error instanceof RpcFailure) {
		return error.error;
	}
	if (!(error instanceof PlatformError)) {
		return {
			code: "internal_error",
			message: error instanceof Error ? error.message : String(error),
			retryable: true,
		};
	}
	const { message } = error;
	switch (error.code) {
		case "invalid_request":
		case "invalid_url":
		case "response_too_large":
			return { code: error.code, message, retryable: false };
		case "unsupported_content_type": {
			const contentType = CONTENT_TYPE.exec(message)?.[1];
			return { code: error.code, message, retryable: false, ...(contentType ? { contentType } : {}) };
		}
		case "fetch_failed": {
			const status = UPSTREAM_STATUS.exec(message)?.[1];
			const httpStatus = status === undefined ? undefined : Number(status);
			// An exhausted `auto` escalation means a real browser was refused too; a 4xx is the
			// target's answer about this URL. Neither changes on retry. Network errors and 5xx may.
			const final =
				error instanceof EscalationExhaustedError ||
				(httpStatus !== undefined && httpStatus < 500 && !TRANSIENT_CLIENT_STATUS.has(httpStatus));
			return {
				code: "fetch_failed",
				message,
				retryable: !final,
				...(httpStatus === undefined ? {} : { httpStatus }),
			};
		}
		case "engine_failed":
		case "engine_unavailable":
			return { code: "engine_failed", message, retryable: true };
		default: {
			const code: RpcErrorCode = "internal_error";
			return { code, message: `${error.code}: ${message}`, retryable: error.status >= 500 };
		}
	}
};

/** ISO-8601 dates as published are kept; other parseable dates become ISO; the rest stay verbatim. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export const normalizeDate = (value: string): string => {
	const trimmed = value.trim();
	if (ISO_DATE.test(trimmed)) {
		return trimmed;
	}
	const parsed = Date.parse(trimmed);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
};

const METADATA_KEYS = [
	"title",
	"description",
	"author",
	"published",
	"modified",
	"siteName",
	"canonicalUrl",
	"lang",
	"image",
	"type",
] as const satisfies readonly (keyof PageMetadata)[];

const toRpcMetadata = (metadata: Record<string, unknown>): RpcPageMetadata => {
	const out: RpcPageMetadata = {};
	for (const key of METADATA_KEYS) {
		const value = metadata[key];
		if (typeof value === "string" && value.length > 0) {
			out[key] = key === "published" || key === "modified" ? normalizeDate(value) : value;
		}
	}
	return out;
};

/** The front matter `htmlToMarkdown` prepends (`---\n…\n---\n\n`), which is not body text. */
const FRONT_MATTER = /^---\n[\s\S]*?\n---\n+/;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MARKDOWN_IMAGE = /!\[([^[\]]*)\]\(\s*(<[^<>\n]+>|[^\s)]+)/g;

/** Images of the markdown outside code blocks: absolute public URLs, in order, each once. */
export const markdownImages = (markdown: string, baseUrl: string): { url: string; alt?: string }[] => {
	const images: { url: string; alt?: string }[] = [];
	const seen = new Set<string>();
	let fence: string | undefined;
	for (const line of markdown.split("\n")) {
		const marker = FENCE.exec(line)?.[1];
		if (fence !== undefined) {
			if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
				fence = undefined;
			}
			continue;
		}
		if (marker !== undefined) {
			fence = marker;
			continue;
		}
		for (const [, rawAlt = "", destination = ""] of line.matchAll(MARKDOWN_IMAGE)) {
			const url = resolveImageUrl(destination, baseUrl);
			if (url === undefined || seen.has(url)) {
				continue;
			}
			seen.add(url);
			const alt = rawAlt.trim();
			images.push(alt ? { url, alt } : { url });
		}
	}
	return images;
};

const run = async (deps: RpcConvertDeps, rawUrl: unknown, rawOptions: unknown): Promise<RpcConvertResult> => {
	const { url, options } = parseInput(rawUrl, rawOptions);
	const log = deps.log ?? console;
	const started = (deps.now ?? Date.now)();

	if (!(await checkRateLimit(deps.limiter, { binding: "RATE_LIMIT_INTERNAL", key: options.tenant }))) {
		throw new RpcFailure({
			code: "rate_limited",
			message: `internal limit reached for tenant "${options.tenant}"; retry in a minute`,
			retryable: true,
		});
	}

	const request: ScrapeRequest = {
		url,
		engine: options.engine,
		screenshot: false,
		rehostImages: false,
		convert: {
			...(options.extractor ? { extractor: options.extractor } : {}),
			frontmatter: options.frontmatter,
			titleHeading: options.titleHeading,
		},
	};
	try {
		const page = await fetchForScrape(deps.scrape, request);
		// Only `auto`, `fetch` and `browser` are accepted, and `auto` without a region resolves to
		// one of the two.
		const engine = page.engine === "browser" ? "browser" : "fetch";
		const warnings: RpcWarning[] = (page.notes ?? []).map(({ code, message }) => ({ code, message }));
		const result: RpcConvertResult = { url: page.url, engine, markdown: "" };

		if (options.formats.includes("markdown")) {
			const converted = await convertFetchedPage(deps.scrape, request, page);
			const body = options.frontmatter ? converted.markdown.replace(FRONT_MATTER, "") : converted.markdown;
			result.markdown = converted.markdown;
			result.metadata = toRpcMetadata(converted.metadata);
			result.extraction = {
				// Presets whose extractor reports nothing (`none`, `minimal`) are named by the preset.
				extractor: converted.extraction?.extractor ?? options.extractor ?? "auto",
				confidence: converted.extraction?.confidence ?? null,
				textLength: body.trim().length,
			};
			result.images = markdownImages(converted.markdown, page.url);
		}
		if (options.formats.includes("links")) {
			result.links = extractPageLinks(page.html, page.url);
		}
		if (warnings.length > 0) {
			result.warnings = warnings;
		}
		if (page.warning !== undefined) {
			result.warning = page.warning;
		}
		log.info("rpc_convert", { tenant: options.tenant, engine, ms: (deps.now ?? Date.now)() - started });
		return result;
	} catch (error) {
		log.warn("rpc_convert_failed", { tenant: options.tenant, url, error: String(error) });
		throw error;
	}
};

/** `PlatformRpc.tryConvert`: every failure comes back as data, with a code and whether a retry may help. */
export const rpcTryConvert = async (
	deps: RpcConvertDeps,
	rawUrl: unknown,
	rawOptions: unknown,
): Promise<RpcConvertOutcome> => {
	try {
		return { ok: true, result: await run(deps, rawUrl, rawOptions) };
	} catch (error) {
		return { ok: false, error: toRpcError(error) };
	}
};

/** `PlatformRpc.convert`: the result, or a thrown `Error("<code>: <message>")`. */
export const rpcConvert = async (
	deps: RpcConvertDeps,
	rawUrl: unknown,
	rawOptions: unknown,
): Promise<RpcConvertResult> => {
	const outcome = await rpcTryConvert(deps, rawUrl, rawOptions);
	if (!outcome.ok) {
		throw new PlatformRpcError(outcome.error.code, outcome.error.message);
	}
	return outcome.result;
};
