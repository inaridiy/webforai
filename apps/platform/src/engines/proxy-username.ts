/**
 * Webshare proxy username assembly.
 *
 * Webshare encodes per-request options in the username rather than in a separate API:
 * `{username}-rotate` rotates the exit IP per request, and `{username}-{CC}-rotate` additionally
 * pins the exit to a country. The order matters — `-rotate` must stay last — so the country is
 * *inserted* rather than appended.
 *
 * This module is deliberately dependency-free: it is imported both by the Worker and by the
 * container bundle (which must not pull in `core/`), and it is the unit under test for the
 * suffix rules.
 */

const ROTATE_SUFFIX = "-rotate";

/**
 * Builds the proxy username for one request.
 *
 * Idempotent on both suffixes: a configured username that already carries `-rotate` (or the same
 * country) is normalised instead of getting a second copy, because the credential comes from an
 * operator-set secret we do not control.
 */
export const buildProxyUsername = (username: string, country?: string): string => {
	const base = username.endsWith(ROTATE_SUFFIX) ? username.slice(0, -ROTATE_SUFFIX.length) : username;
	if (!country) {
		return `${base}${ROTATE_SUFFIX}`;
	}
	const suffix = `-${country}`;
	return base.endsWith(suffix) ? `${base}${ROTATE_SUFFIX}` : `${base}${suffix}${ROTATE_SUFFIX}`;
};
