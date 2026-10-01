import { Hono } from "hono";
import { ARTIFACT_ROUTE_PREFIX, isInlineArtifactType, verifyArtifactToken } from "../artifacts/store";
import { loadConfig } from "../env";
import { errorBody, onPlatformError } from "./errors";

/**
 * Serves R2 artifacts (screenshots, rehosted images, oversized job results).
 *
 * The Worker holds an R2 *binding*, not S3 credentials, so objects cannot be presigned; they are
 * streamed back through here instead, gated on the expiring HMAC token that `signArtifactUrl`
 * put in the URL. The token is bound to the exact key, so it cannot be replayed for another
 * object, and responses are `private` so no shared cache ever holds someone else's artifact.
 *
 * These bytes come from arbitrary third-party sites and are served from the app's own origin, so
 * every response is locked down (`ARTIFACT_SECURITY_HEADERS`): a sandboxing CSP and `nosniff`
 * keep even a mislabelled object from running as a document here, and only raster images and
 * JSON results render inline — anything else (e.g. an SVG stored before rehosting refused them)
 * is a download.
 */
export const ARTIFACT_SECURITY_HEADERS: Record<string, string> = {
	"content-security-policy": "default-src 'none'; sandbox",
	"x-content-type-options": "nosniff",
	// Rehosted images are embedded by Markdown consumers on other sites; cross-origin is the point.
	"cross-origin-resource-policy": "cross-origin",
	"referrer-policy": "no-referrer",
};

const withSecurityHeaders = (headers: Headers): Headers => {
	for (const [name, value] of Object.entries(ARTIFACT_SECURITY_HEADERS)) {
		headers.set(name, value);
	}
	return headers;
};

export const artifactRoutes = () => {
	const app = new Hono<{ Bindings: Env }>();
	app.onError(onPlatformError);

	// Error bodies too: nothing under this prefix should ever be interpretable as a page.
	app.use(`${ARTIFACT_ROUTE_PREFIX}*`, async (c, next) => {
		await next();
		withSecurityHeaders(c.res.headers);
	});

	app.get(`${ARTIFACT_ROUTE_PREFIX}*`, async (c) => {
		const key = decodeKey(c.req.path.slice(ARTIFACT_ROUTE_PREFIX.length));
		const token = c.req.query("token");

		if (!(key && token)) {
			return c.json(errorBody("invalid_token", "This artifact URL is missing its token."), 403);
		}

		const config = loadConfig(c.env);
		if (!(await verifyArtifactToken({ key, token, config }))) {
			// One code for "wrong" and "expired": a probing client learns nothing about the key.
			return c.json(errorBody("invalid_token", "This artifact URL is invalid or has expired."), 403);
		}

		const object = await c.env.ARTIFACTS.get(key);
		if (!object) {
			return c.json(errorBody("artifact_not_found", "This artifact has expired or was deleted."), 404);
		}

		const headers = new Headers();
		object.writeHttpMetadata(headers);
		if (!headers.has("content-type")) {
			headers.set("content-type", "application/octet-stream");
		}
		if (!isInlineArtifactType(headers.get("content-type") ?? "")) {
			headers.set("content-disposition", "attachment");
		}
		withSecurityHeaders(headers);
		headers.set("etag", object.httpEtag);
		// Private: the URL carries a bearer-ish token, so only the client that has it may cache.
		headers.set("cache-control", "private, max-age=3600");

		return new Response(object.body, { headers });
	});

	return app;
};

/** Keys are ASCII, but a client may still percent-encode; a malformed escape is simply rejected. */
const decodeKey = (raw: string): string | undefined => {
	try {
		const decoded = decodeURIComponent(raw);
		return decoded.includes("..") ? undefined : decoded;
	} catch {
		return undefined;
	}
};
