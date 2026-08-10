import { Hono } from "hono";
import { ARTIFACT_ROUTE_PREFIX, verifyArtifactToken } from "../artifacts/store";
import { loadConfig } from "../env";
import { errorBody, onPlatformError } from "./errors";

/**
 * Serves R2 artifacts (screenshots, rehosted images, oversized job results).
 *
 * The Worker holds an R2 *binding*, not S3 credentials, so objects cannot be presigned; they are
 * streamed back through here instead, gated on the expiring HMAC token that `signArtifactUrl`
 * put in the URL. The token is bound to the exact key, so it cannot be replayed for another
 * object, and responses are `private` so no shared cache ever holds someone else's artifact.
 */
export const artifactRoutes = () => {
	const app = new Hono<{ Bindings: Env }>();
	app.onError(onPlatformError);

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
