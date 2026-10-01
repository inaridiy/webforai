import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { getBillingState } from "../billing/state";
import { createDb } from "../db/client";
import { loadConfig } from "../env";
import {
	RATE_LIMIT_RETRY_AFTER_SECONDS,
	type RateLimiter,
	type Tier,
	checkRateLimit,
	rateLimitedMessage,
	tierOf,
	tierRateLimitBinding,
} from "../ops/limits";
import type { Auth } from "./auth";

type SessionResult = Awaited<ReturnType<Auth["api"]["getSession"]>>;
export type SessionUser = NonNullable<SessionResult>["user"];
export type SessionRecord = NonNullable<SessionResult>["session"];

/** Variables every authenticated route can rely on. Routes must read the user from here. */
export interface AuthVariables {
	user: SessionUser | null;
	session: SessionRecord | null;
	apiKeyUserId: string;
	apiKeyId: string;
	/** Subscription tier of the key's owner, resolved once per `/v1` request. */
	apiKeyTier: Tier;
}

type AuthEnv = { Bindings: Env; Variables: AuthVariables };

const errorJson = (c: Context, status: 401 | 429, code: string, message: string) =>
	c.json({ error: { code, message } }, status);

/**
 * Resolves the cookie session once per request. Never fails the request — `requireSession`
 * decides that, so public routes can share the same middleware chain.
 */
export const sessionMiddleware = (auth: Auth): MiddlewareHandler<AuthEnv> =>
	createMiddleware<AuthEnv>(async (c, next) => {
		const result = await auth.api.getSession({ headers: c.req.raw.headers });
		c.set("user", result?.user ?? null);
		c.set("session", result?.session ?? null);
		await next();
	});

/** Must run after `sessionMiddleware`. */
export const requireSession: MiddlewareHandler<AuthEnv> = createMiddleware<AuthEnv>(async (c, next) => {
	if (!c.get("user")) return errorJson(c, 401, "unauthorized", "Sign in required.");
	await next();
});

/** `Authorization: Bearer <key>` is canonical; `x-api-key` is accepted for convenience. */
const readApiKey = (c: Context): string | undefined => {
	const authorization = c.req.header("authorization");
	if (authorization) {
		const [scheme, ...rest] = authorization.split(" ");
		const value = rest.join(" ").trim();
		if (scheme?.toLowerCase() === "bearer" && value) return value;
	}
	return c.req.header("x-api-key")?.trim() || undefined;
};

/** Verification failures Better Auth reports when a key is throttled rather than invalid. */
const THROTTLED_CODES = new Set(["RATE_LIMITED", "RATE_LIMIT_EXCEEDED", "USAGE_EXCEEDED"]);

/** What the `/v1` key check needs beyond Better Auth — injected so tests use fakes. */
export interface ApiKeyGateDeps {
	/** `paid` with an active subscription (the spend guard's predicate), else `free`. */
	tierOf(userId: string): Promise<Tier>;
	/** The tier's Rate Limiting binding; `undefined` where the deployment has none. */
	limiter(tier: Tier): RateLimiter | undefined;
	/** Where a caller without a working key gets one (spec: errors name the dashboard). */
	dashboardUrl: string;
}

export type ApiKeyGateDepsFactory = (env: Env) => ApiKeyGateDeps;

export const dashboardUrlOf = (baseUrl: string): string => `${baseUrl.replace(/\/+$/u, "")}/dashboard`;

export const defaultApiKeyGateDeps: ApiKeyGateDepsFactory = (env) => ({
	tierOf: async (userId) => tierOf(await getBillingState(createDb(env), userId)),
	// Typed as always present by `wrangler types`; a deployment without `ratelimits` has none.
	limiter: (tier) => env[tierRateLimitBinding(tier)] as RateLimiter | undefined,
	dashboardUrl: dashboardUrlOf(loadConfig(env).BASE_URL),
});

/**
 * Job status/result reads do not count against the tier's per-minute budget — waiting on a few
 * jobs at the SDK's poll interval would otherwise exhaust a free account's budget — but they
 * have their own: 600/min per account on every tier.
 */
export const isJobRead = (method: string, path: string): boolean =>
	method === "GET" && /^\/v1\/jobs(?:\/|$)/.test(path);

/**
 * Authenticates `/v1/*` requests. The owning user is taken from the verified key's
 * `referenceId` — a client-supplied user id is never trusted anywhere in the platform.
 *
 * Then applies the per-account request limit (Workers Rate Limiting binding of the owner's
 * tier, keyed by user id — not key id, since keys are free to create). Better Auth's per-key
 * D1 limiter is disabled (`src/auth/auth.ts`); `THROTTLED_CODES` still maps a key-level
 * refusal (e.g. a key created with a usage quota) to 429.
 */
export const requireApiKey = (
	auth: Auth,
	createDeps: ApiKeyGateDepsFactory = defaultApiKeyGateDeps,
): MiddlewareHandler<AuthEnv> =>
	createMiddleware<AuthEnv>(async (c, next) => {
		const deps = createDeps(c.env);
		const key = readApiKey(c);
		if (!key) {
			return errorJson(c, 401, "invalid_api_key", `Missing API key. Create a key at ${deps.dashboardUrl}`);
		}

		const result = await auth.api.verifyApiKey({ body: { key } });
		if (!result.valid || !result.key) {
			const code = result.error?.code;
			if (code && THROTTLED_CODES.has(code)) {
				return errorJson(c, 429, "rate_limited", "API key rate limit exceeded.");
			}
			return errorJson(c, 401, "invalid_api_key", `Invalid API key. Create a key at ${deps.dashboardUrl}`);
		}

		const userId = result.key.referenceId;
		const tier = await deps.tierOf(userId);
		// Job reads draw from their own, larger budget (the paid binding under a separate key), so
		// polling cannot starve a free account's requests yet stays bounded.
		const allowed = isJobRead(c.req.method, c.req.path)
			? await checkRateLimit(deps.limiter("paid"), {
					binding: tierRateLimitBinding("paid"),
					key: `job-reads:${userId}`,
				})
			: await checkRateLimit(deps.limiter(tier), { binding: tierRateLimitBinding(tier), key: userId });
		if (!allowed) {
			c.header("Retry-After", String(RATE_LIMIT_RETRY_AFTER_SECONDS));
			return errorJson(c, 429, "rate_limited", rateLimitedMessage(tier));
		}

		c.set("apiKeyUserId", userId);
		c.set("apiKeyId", result.key.id);
		c.set("apiKeyTier", tier);
		await next();
	});
