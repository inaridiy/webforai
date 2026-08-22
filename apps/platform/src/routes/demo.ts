import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import { REGIONS, type Region } from "../core/regions";
import { EngineUnavailableError, PlatformError, type ScrapeRequest, type ScrapeSuccess } from "../core/types";
import { describeZodError, onPlatformError } from "./errors";

/**
 * The public, unauthenticated demo (`POST /v1/demo/scrape`).
 *
 * It exists so the docs site can show a real conversion without asking for a key, which makes it
 * the one route where a stranger can make us spend proxy bandwidth. Three rules follow:
 *
 * 1. Both rate limits are checked **before** the proxy runs, so a rejected request costs nothing.
 * 2. The limiter is **fail-closed**: a KV read or write we cannot complete denies the request
 *    rather than letting an unmetered flood through.
 * 3. Nothing is billed — there is no user to bill — so the caps below are the only spend bound.
 *
 * Everything with a side effect is injected (`DemoDepsFactory`), which is also why the real
 * engine wiring lives in the composition root rather than here: this module must stay importable
 * in unit tests, and `engines/` pulls in Workers-only modules.
 */

/** The demo is a fixed product: one engine, no artifacts, default conversion. */
export const DEMO_ENGINE = "proxy-fetch" as const;

/** Per-IP fixed window. */
export const DEMO_IP_LIMIT = 5;
export const DEMO_IP_WINDOW_SECONDS = 10 * 60;

/** Global daily cap — the hard ceiling on what the demo can cost in one UTC day. */
export const DEMO_GLOBAL_LIMIT = 500;
export const DEMO_GLOBAL_WINDOW_SECONDS = 24 * 60 * 60;

/** Markdown is a teaser here; the full document is what the paid API is for. */
export const DEMO_MARKDOWN_LIMIT = 8000;

/** KV rejects an `expirationTtl` below 60s, so short remainders are rounded up to it. */
const MIN_KV_TTL_SECONDS = 60;

export const demoBodySchema = z
	.object({
		url: z.string().url(),
		region: z.enum(REGIONS).default("auto"),
	})
	.strict();

export type DemoBody = z.infer<typeof demoBodySchema>;

/** The slice of KV the limiter uses — injected so the windows are testable with a Map. */
export interface DemoKv {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface DemoDeps {
	kv: DemoKv;
	/** Gates the whole endpoint: without a configured proxy there is no demo to serve. */
	proxyEnabled: boolean;
	/** Runs the fixed demo scrape. Injected so tests exercise the limiter without proxy egress. */
	runScrape(request: ScrapeRequest): Promise<ScrapeSuccess>;
	now(): Date;
}

/** Built per request: bindings and config only exist inside an invocation. */
export type DemoDepsFactory = (env: Env) => DemoDeps;

export const demoIpKey = (ip: string): string => `demo:ip:${ip}`;

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
	markdown: string;
	truncated: boolean;
	title?: string;
	metadata: Record<string, unknown>;
}

const truncate = (markdown: string): { markdown: string; truncated: boolean } =>
	markdown.length > DEMO_MARKDOWN_LIMIT
		? { markdown: markdown.slice(0, DEMO_MARKDOWN_LIMIT), truncated: true }
		: { markdown, truncated: false };

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

		// Before the limiter: a deployment without a configured proxy has nothing to protect,
		// and a misconfiguration must not consume the caller's demo allowance.
		if (!deps.proxyEnabled) {
			throw new EngineUnavailableError(DEMO_ENGINE, "the demo requires a configured proxy");
		}

		const now = deps.now();
		const decision = await checkDemoLimits(deps, demoLimitsFor(demoClientIp(c.req.raw.headers), now), now);
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
			markdown,
			truncated,
			...(typeof title === "string" ? { title } : {}),
			metadata: result.metadata,
		};
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
