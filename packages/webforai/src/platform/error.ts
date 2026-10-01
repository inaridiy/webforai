/**
 * Error thrown for any non-2xx platform response, mirroring the API's uniform
 * `{ error: { code, message } }` envelope.
 *
 * `code` values worth branching on: `invalid_request` (400), `invalid_api_key` (401),
 * `payment_required` / `spend_cap_reached` (402), `robots_disallowed` (403), `job_not_found`
 * (404), `rate_limited` / `too_many_jobs` (429, `retryAfter` set when the server sends it),
 * `engine_unavailable` / `result_unavailable` / `scheduling_unknown` (503). 401 and 402
 * messages end with a hint naming the deployment's dashboard. The client never retries on its
 * own; a caller that wants backoff should honour `retryAfter` when present.
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
