import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";

import { errorBody } from "./errors";

/**
 * Request/response hardening for the routes this Worker serves itself (`/api`, `/v1`,
 * `/artifacts`, `/health`). The SPA's static assets get their headers from `public/_headers`,
 * which Workers Assets applies without running this code.
 */

/**
 * Baseline headers for every Worker response. No CSP here: these are JSON (or redirects from
 * Better Auth); artifacts carry their own sandboxing CSP (`routes/artifacts.ts`).
 */
export const WORKER_SECURITY_HEADERS: Record<string, string> = {
	"strict-transport-security": "max-age=31536000; includeSubDomains",
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
	"referrer-policy": "strict-origin-when-cross-origin",
};

/** Adds the baseline without overriding a route's own choice (artifacts set a stricter referrer policy). */
export const securityHeaders: MiddlewareHandler = createMiddleware(async (c, next) => {
	await next();
	const apply = (headers: Headers) => {
		for (const [name, value] of Object.entries(WORKER_SECURITY_HEADERS)) {
			if (!headers.has(name)) {
				headers.set(name, value);
			}
		}
	};
	try {
		apply(c.res.headers);
	} catch {
		// A response passed through from `fetch()` has immutable headers; copy it once.
		c.res = new Response(c.res.body, c.res);
		apply(c.res.headers);
	}
});

/**
 * Largest accepted request body. The biggest legitimate body — a 100-URL batch at the 2,048
 * character URL cap — is about 205 KiB.
 */
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;

/**
 * Refuses oversized bodies with `413 payload_too_large` before any route parses them. A chunked
 * body without `Content-Length` is cut off at the cap instead, which the JSON routes then report
 * as an unparseable body (`400 invalid_request`).
 */
export const requestBodyLimit: MiddlewareHandler = bodyLimit({
	maxSize: MAX_REQUEST_BODY_BYTES,
	onError: (c) => c.json(errorBody("payload_too_large", `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`), 413),
});

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for cookie-authenticated routes: a state-changing request must carry an `Origin`
 * equal to the deployment's own. Browsers send `Origin` on every cross-origin request and on
 * same-origin `POST`s, so the dashboard SPA always passes; a missing or foreign one is refused
 * (`403 forbidden_origin`) rather than trusting `SameSite` cookies alone.
 *
 * Not for `/api/auth/*` (Better Auth checks its own `trustedOrigins`, and the Stripe webhook
 * there is server-to-server) nor `/v1` (API-key bearer auth, no ambient credentials).
 */
export const requireSameOrigin = (expectedOrigin: (c: Context) => string): MiddlewareHandler =>
	createMiddleware(async (c, next) => {
		if (SAFE_METHODS.has(c.req.method)) {
			await next();
			return;
		}
		const origin = c.req.header("origin");
		if (origin === undefined || origin !== expectedOrigin(c)) {
			return c.json(
				errorBody("forbidden_origin", "State-changing dashboard requests must come from the dashboard's own origin."),
				403,
			);
		}
		await next();
	});
