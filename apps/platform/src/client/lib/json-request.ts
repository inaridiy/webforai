import type { z } from "zod";
import type { Result } from "./api";

const errorMessageOf = (body: unknown, status: number): string => {
	if (typeof body === "object" && body !== null && "error" in body) {
		const inner = body.error;
		if (typeof inner === "string" && inner.length > 0) return inner;
		if (typeof inner === "object" && inner !== null && "message" in inner) {
			if (typeof inner.message === "string" && inner.message.length > 0) return inner.message;
		}
	}
	return `Request failed with status ${status}.`;
};

/** Transport failures include response-body reads, not just the initial connection. */
export const requestJson = async <T>(
	fetcher: typeof fetch,
	path: string,
	schema: z.ZodType<T>,
	init?: RequestInit,
): Promise<Result<T>> => {
	let response: Response;
	let text: string;
	try {
		const headers = new Headers(init?.headers);
		headers.set("accept", "application/json");
		if (init?.body !== undefined) headers.set("content-type", "application/json");
		response = await fetcher(path, { ...init, credentials: "include", headers });
		text = await response.text();
	} catch {
		return {
			ok: false,
			error: "Network error — the platform API response could not be read. Please retry.",
			status: 0,
		};
	}
	let body: unknown = null;
	try {
		body = JSON.parse(text);
	} catch {
		// Preserve HTTP failure status even when a proxy returned HTML instead of JSON.
	}
	if (!response.ok) return { ok: false, error: errorMessageOf(body, response.status), status: response.status };
	const parsed = schema.safeParse(body);
	return parsed.success
		? { ok: true, value: parsed.data }
		: { ok: false, error: "The API returned an unexpected response. Please retry.", status: response.status };
};
