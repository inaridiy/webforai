import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
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

/**
 * Authenticates `/v1/*` requests. The owning user is taken from the verified key's
 * `referenceId` — a client-supplied user id is never trusted anywhere in the platform.
 */
export const requireApiKey = (auth: Auth): MiddlewareHandler<AuthEnv> =>
	createMiddleware<AuthEnv>(async (c, next) => {
		const key = readApiKey(c);
		if (!key) return errorJson(c, 401, "invalid_api_key", "Missing API key.");

		const result = await auth.api.verifyApiKey({ body: { key } });
		if (!result.valid || !result.key) {
			const code = result.error?.code;
			if (code && THROTTLED_CODES.has(code)) {
				return errorJson(c, 429, "rate_limited", "API key rate limit exceeded.");
			}
			return errorJson(c, 401, "invalid_api_key", "Invalid API key.");
		}

		c.set("apiKeyUserId", result.key.referenceId);
		c.set("apiKeyId", result.key.id);
		await next();
	});
