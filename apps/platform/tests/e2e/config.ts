/**
 * Shared E2E configuration.
 *
 * Both the global setup (which boots the real Worker) and the specs import from here, so the
 * port, base URL and dev-vars content are defined exactly once. `E2E_PORT` overrides the port
 * for parallel/CI runs; `BASE_URL` is derived from it and is what the Worker's Better Auth
 * `baseURL` is set to, so an `Origin` header equal to `BASE_URL` passes the auth origin check.
 */

export const PORT = Number(process.env.E2E_PORT ?? 8788);

export const BASE_URL = `http://localhost:${PORT}`;

/**
 * Throwaway secrets for local bring-up only — never real credentials.
 *
 * - `BETTER_AUTH_SECRET` is a fixed ≥32-char dev string.
 * - `BASE_URL` matches the dev-server port so Better Auth accepts a same-origin `Origin` header.
 * - Fake `PROXY_*` settings set `proxyEnabled=true`. That matters for the demo test: with
 *   proxy disabled the demo endpoint returns 503 *before* the rate limiter runs, so the limiter
 *   would never engage. With (fake) creds present the limiter runs; the actual proxy fetch fails
 *   (no egress) which is fine — the demo test asserts the limiter, not the proxy.
 */
export const devVarsContent = (): string =>
	[
		"BETTER_AUTH_SECRET=e2e-throwaway-secret-0123456789abcdef0123456789",
		`BASE_URL=${BASE_URL}`,
		"PROXY_URL=http://127.0.0.1:9",
		"PROXY_USERNAME=e2e-fake-user",
		"PROXY_PASSWORD=e2e-fake-pass",
		"",
	].join("\n");
