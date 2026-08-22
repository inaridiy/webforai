/**
 * Error thrown for any non-2xx platform response, mirroring the API's uniform
 * `{ error: { code, message } }` envelope.
 *
 * `code` values worth branching on: `invalid_request` (400), `invalid_api_key` (401),
 * `payment_required` (402), `job_not_found` (404), `rate_limited` (429, `retryAfter` set on
 * the demo endpoint), `engine_unavailable` (503). The client never retries on its own; a
 * caller that wants backoff should honour `retryAfter` when present.
 *
 * Network-level failures (DNS, refused connections) are NOT wrapped — they propagate as the
 * runtime's own `fetch` errors. `code` is `invalid_response` when the server answered with
 * something that is not the JSON envelope (usually a wrong `baseUrl`).
 */
export class PlatformApiError extends Error {
	readonly code: string;
	readonly status: number;
	/** Seconds to wait before retrying; set on rate-limited responses that provide it. */
	readonly retryAfter?: number;

	constructor(code: string, message: string, status: number, retryAfter?: number) {
		super(message);
		this.name = "PlatformApiError";
		this.code = code;
		this.status = status;
		this.retryAfter = retryAfter;
	}
}
