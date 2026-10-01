import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import { assertDemoRegionAllowed } from "../billing/guard";
import { REGIONS, type Region } from "../core/regions";
import { assertPublicHttpUrl } from "../core/ssrf";
import { type Engine, PlatformError, type ScrapeRequest, type ScrapeSuccess } from "../core/types";
import { clientIpBucket } from "../ops/ip";
import { type RateLimiter, checkRateLimit } from "../ops/limits";
import { describeZodError, onPlatformError } from "./errors";
import { MAX_URL_LENGTH } from "./schemas";

/**
 * The public, unauthenticated demo (`POST /v1/demo/scrape`).
 *
 * It exists so the docs site can show a real conversion without asking for a key, which makes it
 * the one route where a stranger can make us spend proxy bandwidth or browser renders. Three
 * rules follow:
 *
 * 1. Every rate limit is checked **before** any engine runs, so a rejected request costs nothing.
 * 2. The limiter is **fail-closed**: a KV read or write (or a rate-limit binding call) we cannot
 *    complete denies the request rather than letting an unmetered flood through.
 * 3. Nothing is billed — there is no user to bill — so the caps below are the only spend bound.
 *
 * Everything with a side effect is injected (`DemoDepsFactory`), which is also why the real
 * engine wiring lives in the composition root rather than here: this module must stay importable
 * in unit tests, and `engines/` pulls in Workers-only modules.
 */

/**
 * The demo is a fixed product: the `auto` engine (so a client-rendered site still shows real
 * markdown — the demo must never lose to its own landing page), no artifacts, default
 * conversion. The caller chooses only the URL and the region.
 */
export const DEMO_ENGINE = "auto" as const;

/**
 * Per-client burst cap on the `DEMO_RATE_LIMIT` binding (wrangler.jsonc: 3 per 60 s). The
 * binding's counter is atomic per location, unlike the KV windows below, so a parallel burst
 * cannot slip past it; its period can only be 10 or 60 s, hence the KV window for the longer
 * bound. Keep this constant in sync with wrangler.jsonc (it only feeds the 429 message).
 */
export const DEMO_BURST_LIMIT = 3;
export const DEMO_BURST_WINDOW_SECONDS = 60;

/**
 * Per-client fixed window in KV (IPv4 address or IPv6 /64). KV read-modify-write is not
 * atomic, so concurrent requests can overshoot it — approximate by design; the burst binding
 * above bounds how far.
 */
export const DEMO_IP_LIMIT = 5;
export const DEMO_IP_WINDOW_SECONDS = 10 * 60;

/**
 * Global daily cap in KV — the ceiling on what the demo can cost in one UTC day. Approximate
 * for the same reason (non-atomic KV, eventually consistent across locations): concurrent
 * requests near the cap can overshoot it slightly.
 */
export const DEMO_GLOBAL_LIMIT = 500;
export const DEMO_GLOBAL_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Enough for a typical article to come back whole, so the demo shows real extraction quality;
 * very long pages are still cut with a visible notice. Conversion always runs on the whole
 * page, so this bounds only the response size — the rate limits above bound the cost.
 */
export const DEMO_MARKDOWN_LIMIT = 40_000;

/** KV rejects an `expirationTtl` below 60s, so short remainders are rounded up to it. */
const MIN_KV_TTL_SECONDS = 60;

export const demoBodySchema = z
	.object({
		url: z.string().max(MAX_URL_LENGTH).url(),
		region: z.enum(REGIONS).default("auto"),
	})
	.strict();

export type DemoBody = z.infer<typeof demoBodySchema>;

/** The slice of KV the limiter uses — injected so the windows are testable with a Map. */
export interface DemoKv {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * Recent demo results by URL + region. The docs site's example buttons send the same few URLs
 * over and over; a hit skips the scrape and the rate limiter alike (it costs nothing to serve).
 * Optional so a deployment or test without a cache simply always scrapes.
 */
export interface DemoCache {
	get(key: string): Promise<DemoResponse | undefined>;
	put(key: string, value: DemoResponse): Promise<void>;
}

/** Long enough to absorb bursts on the example URLs, short enough that results stay current. */
export const DEMO_CACHE_TTL_SECONDS = 10 * 60;

/**
 * A URL, because that is what the Cache API keys on: this deployment's own origin (the cache is
 * scoped to its zone) plus the normalized target — fragment dropped, host lowercased by `URL`.
 */
export const demoCacheKey = (origin: string, url: string, region: Region): string => {
	const target = new URL(url);
	target.hash = "";
	return `${origin}/v1/demo/scrape/cache?region=${region}&url=${encodeURIComponent(target.href)}`;
};

export interface DemoDeps {
	kv: DemoKv;
	/** The `DEMO_RATE_LIMIT` binding; without it only the KV windows apply (warned once). */
	burstLimiter?: RateLimiter;
	cache?: DemoCache;
	/** Runs the fixed demo scrape. Injected so tests exercise the limiter without proxy egress. */
	runScrape(request: ScrapeRequest): Promise<ScrapeSuccess>;
	now(): Date;
}

/** Built per request: bindings and config only exist inside an invocation. */
export type DemoDepsFactory = (env: Env) => DemoDeps;

/** Keyed by `clientIpBucket`: an IPv4 address or an IPv6 /64. */
export const demoIpKey = (ip: string): string => `demo:ip:${clientIpBucket(ip)}`;

/** UTC day in the key, so the global window rolls over without a stored reset time. */
export const demoGlobalKey = (now: Date): string => `demo:global:${now.toISOString().slice(0, 10)}`;

/**
 * The client address. `CF-Connecting-IP` is the only header Cloudflare guarantees and rewrites;
 * the others are caller-controlled and used solely so a non-Cloudflare deployment still buckets
 * *something*. An unidentifiable client shares one bucket rather than getting a free pass.
 */
export const demoClientIp = (headers: Headers): string => {
	const direct = headers.get("cf-connecting-ip")?.trim();
	if (direct) {
		return direct;
	}
	const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	return forwarded || "unknown";
};

/** A fixed window: `count` requests until `resetAt`, both stored in the KV value. */
interface WindowState {
	count: number;
	/** Epoch milliseconds. */
	resetAt: number;
}

const parseWindow = (raw: string | null, now: number): WindowState | undefined => {
	if (raw === null) {
		return undefined;
	}
	try {
		const value = JSON.parse(raw) as Partial<WindowState>;
		if (typeof value?.count !== "number" || typeof value?.resetAt !== "number" || value.resetAt <= now) {
			// Expired or unreadable: only this module writes these keys, so a value we cannot use
			// is our own stale data, not an attack — starting a fresh window is correct.
			return undefined;
		}
		return { count: value.count, resetAt: value.resetAt };
	} catch {
		return undefined;
	}
};

const secondsUntil = (resetAt: number, now: number): number => Math.max(1, Math.ceil((resetAt - now) / 1000));

export interface DemoLimit {
	key: string;
	limit: number;
	/** How long a *new* window lasts; the stored `resetAt` is what an existing one is judged by. */
	windowSeconds: number;
	/** Human phrase for the 429 message — "10 minutes" reads better than "600 seconds". */
	window: string;
}

export type DemoLimitDecision =
	| { allowed: true }
	| { allowed: false; code: "rate_limited"; message: string; retryAfter: number };

/** Any KV failure is a denial: an unmetered demo is the one outcome we cannot afford. */
const FAIL_CLOSED_RETRY_AFTER = 60;

const failClosed = (): DemoLimitDecision => ({
	allowed: false,
	code: "rate_limited",
	message: "The demo rate limiter is unavailable; please retry shortly.",
	retryAfter: FAIL_CLOSED_RETRY_AFTER,
});

/**
 * Checks every limit, then commits every counter.
 *
 * Read-all-then-write-all rather than check-and-increment per limit: incrementing the per-IP
 * counter for a request the global cap is about to reject would charge a caller for a request
 * that never ran.
 */
export const checkDemoLimits = async (deps: DemoDeps, limits: DemoLimit[], now: Date): Promise<DemoLimitDecision> => {
	const millis = now.getTime();
	let states: (WindowState | undefined)[];
	try {
		states = await Promise.all(limits.map(async (limit) => parseWindow(await deps.kv.get(limit.key), millis)));
	} catch {
		return failClosed();
	}

	for (const [index, limit] of limits.entries()) {
		const state = states[index];
		if (state && state.count >= limit.limit) {
			return {
				allowed: false,
				code: "rate_limited",
				message: `Demo limit reached (${limit.limit} requests per ${limit.window}). Get an API key for unrestricted access.`,
				retryAfter: secondsUntil(state.resetAt, millis),
			};
		}
	}

	try {
		await Promise.all(
			limits.map(async (limit, index) => {
				const state = states[index];
				const next: WindowState = state
					? { count: state.count + 1, resetAt: state.resetAt }
					: { count: 1, resetAt: millis + limit.windowSeconds * 1000 };
				await deps.kv.put(limit.key, JSON.stringify(next), {
					expirationTtl: Math.max(MIN_KV_TTL_SECONDS, secondsUntil(next.resetAt, millis)),
				});
			}),
		);
	} catch {
		return failClosed();
	}

	return { allowed: true };
};

/**
 * The daily window ends at the UTC midnight its key already implies, not 24h after its first
 * request — otherwise a `Retry-After` computed from `resetAt` would tell a caller to wait hours
 * longer than the counter actually lives.
 */
export const secondsUntilUtcMidnight = (now: Date): number => {
	const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
	return Math.min(DEMO_GLOBAL_WINDOW_SECONDS, Math.max(1, Math.ceil((midnight - now.getTime()) / 1000)));
};

export const demoLimitsFor = (ip: string, now: Date): DemoLimit[] => [
	{ key: demoIpKey(ip), limit: DEMO_IP_LIMIT, windowSeconds: DEMO_IP_WINDOW_SECONDS, window: "10 minutes" },
	{ key: demoGlobalKey(now), limit: DEMO_GLOBAL_LIMIT, windowSeconds: secondsUntilUtcMidnight(now), window: "day" },
];

/** The fixed request the demo runs: the caller chooses the URL and the region, nothing else. */
export const demoScrapeRequest = (url: string, region: Region): ScrapeRequest => ({
	url,
	engine: DEMO_ENGINE,
	screenshot: false,
	rehostImages: false,
	region,
	convert: {},
});

export interface DemoResponse {
	url: string;
	region: Region;
	/** The concrete engine `auto` resolved to — shows visitors when a page needed a browser. */
	engine: Engine;
	markdown: string;
	truncated: boolean;
	title?: string;
	metadata: Record<string, unknown>;
}

/** How far back from the limit a blank line may be and still serve as the cut point. */
const TRUNCATION_BOUNDARY_WINDOW = 500;

/**
 * Cuts at the last blank line before the limit and says so inside the markdown itself.
 *
 * A hard character cut can land mid-image-tag right after a section heading, which reads as
 * an extraction failure rather than a teaser limit — a real bug report came from exactly
 * that. Cutting at a paragraph boundary and appending a visible notice keeps the cut honest
 * in both the raw pane and the rendered preview; the `truncated` flag is unchanged.
 */
const truncate = (markdown: string): { markdown: string; truncated: boolean } => {
	if (markdown.length <= DEMO_MARKDOWN_LIMIT) {
		return { markdown, truncated: false };
	}
	const hard = markdown.slice(0, DEMO_MARKDOWN_LIMIT);
	const boundary = hard.lastIndexOf("\n\n");
	const kept = (
		boundary >= DEMO_MARKDOWN_LIMIT - TRUNCATION_BOUNDARY_WINDOW ? hard.slice(0, boundary) : hard
	).trimEnd();
	const omitted = markdown.length - kept.length;
	return {
		markdown: `${kept}\n\n_…truncated (${omitted.toLocaleString(
			"en-US",
		)} more characters). Get an API key for the full document._`,
		truncated: true,
	};
};

type DemoEnv = { Bindings: Env };

/**
 * The demo sub-app.
 *
 * Mounted **before** the `/v1/*` API-key middleware in the composition root: Hono runs matched
 * handlers in registration order and stops at the first one that returns a response, so this
 * route answers before `requireApiKey` is ever reached.
 */
export const demoRoutes = (createDeps: DemoDepsFactory) => {
	const app = new Hono<DemoEnv>();
	app.onError(onPlatformError);

	// The docs site is a different origin, and the endpoint is public by design.
	app.use(
		"*",
		cors({
			origin: "*",
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: ["content-type"],
			maxAge: 86400,
		}),
	);

	app.post("/scrape", async (c) => {
		const deps = createDeps(c.env);
		const body = parseDemoBody(await readJson(c.req.raw));
		assertPublicHttpUrl(body.url);

		// Before the cache and the limiter: a request the demo will not serve must not consume
		// the caller's allowance. A non-`auto` region pins `auto` to the paid proxy tier.
		assertDemoRegionAllowed(body.region, `${new URL(c.req.url).origin}/dashboard`);

		const cacheKey = demoCacheKey(new URL(c.req.url).origin, body.url, body.region);
		const cached = await deps.cache?.get(cacheKey).catch(() => undefined);
		if (cached) {
			c.header("X-Demo-Cache", "hit");
			return c.json(cached);
		}

		const client = demoClientIp(c.req.raw.headers);
		const burstAllowed = await checkRateLimit(deps.burstLimiter, {
			binding: "DEMO_RATE_LIMIT",
			key: clientIpBucket(client),
			failClosed: true,
		});
		if (!burstAllowed) {
			c.header("Retry-After", String(DEMO_BURST_WINDOW_SECONDS));
			return c.json(
				{
					error: {
						code: "rate_limited",
						message: `Demo limit reached (${DEMO_BURST_LIMIT} requests per minute). Get an API key for unrestricted access.`,
						retryAfter: DEMO_BURST_WINDOW_SECONDS,
					},
				},
				429,
			);
		}

		const now = deps.now();
		const decision = await checkDemoLimits(deps, demoLimitsFor(client, now), now);
		if (!decision.allowed) {
			c.header("Retry-After", String(decision.retryAfter));
			return c.json(
				{ error: { code: decision.code, message: decision.message, retryAfter: decision.retryAfter } },
				429,
			);
		}

		const result = await deps.runScrape(demoScrapeRequest(body.url, body.region));
		const { markdown, truncated } = truncate(result.markdown);
		const title = result.metadata.title;

		const response: DemoResponse = {
			url: result.url,
			region: body.region,
			engine: result.engine,
			markdown,
			truncated,
			...(typeof title === "string" ? { title } : {}),
			metadata: result.metadata,
		};
		// A cache that cannot be written only costs a future scrape; never the response.
		await deps.cache?.put(cacheKey, response).catch(() => undefined);
		return c.json(response);
	});

	return app;
};

const readJson = async (request: Request): Promise<unknown> => {
	try {
		return await request.json();
	} catch {
		throw new PlatformError("invalid_request", "Request body must be valid JSON.", 400);
	}
};

const parseDemoBody = (value: unknown): DemoBody => {
	const parsed = demoBodySchema.safeParse(value);
	if (!parsed.success) {
		throw new PlatformError("invalid_request", describeZodError(parsed.error), 400);
	}
	return parsed.data;
};
