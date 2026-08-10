import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { PlatformError } from "../core/types";

/**
 * The one place an unhandled error becomes a response body.
 *
 * `{ error: { code, message } }` is the documented envelope (docs/specs/platform/03_api.md), so
 * every route — public API, dashboard, artifacts — funnels through this handler rather than
 * hand-rolling its own error shape.
 */

export interface ErrorBody {
	error: { code: string; message: string };
}

export const errorBody = (code: string, message: string): ErrorBody => ({ error: { code, message } });

/** Zod issues flattened into one line: enough for a client to fix the request, no schema dump. */
export const describeZodError = (error: ZodError): string =>
	error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");

/**
 * A malformed `env` means the deployment is misconfigured, not that the caller did anything
 * wrong — it must surface as a loud 500 rather than a 400 the caller will retry forever.
 */
const CONFIG_MESSAGE = "Worker configuration is invalid; check the deployment's vars and secrets.";

export const toErrorResponse = (error: unknown, path: string): { body: ErrorBody; status: ContentfulStatusCode } => {
	if (error instanceof PlatformError) {
		return { body: errorBody(error.code, error.message), status: error.status as ContentfulStatusCode };
	}
	if (error instanceof ZodError) {
		// Request bodies are validated explicitly in the routes, so a ZodError reaching the
		// handler comes from `loadConfig`.
		return { body: errorBody("invalid_configuration", `${CONFIG_MESSAGE} (${describeZodError(error)})`), status: 500 };
	}
	const message = error instanceof Error ? error.message : String(error);
	return { body: errorBody("internal_error", `Unhandled error while serving ${path}: ${message}`), status: 500 };
};

export const onPlatformError = (error: unknown, c: Context): Response => {
	const { body, status } = toErrorResponse(error, c.req.path);
	return c.json(body, status);
};
