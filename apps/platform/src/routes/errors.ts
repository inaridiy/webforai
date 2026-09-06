import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { PlatformError } from "../core/types";

interface Validator<T> {
	safeParse(value: unknown): { success: true; data: T } | { success: false; error: ZodError };
}

/**
 * Parses and validates a JSON request body against a schema.
 *
 * Validation failures are 400 `invalid_request` — anything else would let a bad body run a job.
 * Shared by `/v1` and the dashboard playground so the two never diverge on how a malformed body
 * is rejected.
 */
export const parseBody = async <T>(raw: Promise<unknown>, schema: Validator<T>): Promise<T> => {
	let value: unknown;
	try {
		value = await raw;
	} catch {
		throw new PlatformError("invalid_request", "Request body must be valid JSON.", 400);
	}
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		throw new PlatformError("invalid_request", describeZodError(parsed.error), 400);
	}
	return parsed.data;
};

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

export const toErrorResponse = (error: unknown): { body: ErrorBody; status: ContentfulStatusCode } => {
	if (error instanceof PlatformError) {
		return { body: errorBody(error.code, error.message), status: error.status as ContentfulStatusCode };
	}
	if (error instanceof ZodError) {
		// Request bodies are validated explicitly in the routes, so a ZodError reaching the
		// handler comes from `loadConfig`.
		return { body: errorBody("invalid_configuration", CONFIG_MESSAGE), status: 500 };
	}
	return { body: errorBody("internal_error", "An unexpected error occurred. Please retry later."), status: 500 };
};

export const onPlatformError = (error: unknown, c: Context): Response => {
	const { body, status } = toErrorResponse(error);
	if (!(error instanceof PlatformError)) {
		console.error("platform_request_failed", { path: c.req.path, error });
	}
	return c.json(body, status);
};
