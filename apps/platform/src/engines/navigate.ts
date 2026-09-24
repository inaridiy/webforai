/**
 * One navigation per page for both browser engines (`@cloudflare/playwright` in the Worker,
 * Playwright in the container), typed structurally so either page object fits.
 *
 * The page is loaded once to `domcontentloaded`, then given the rest of the budget to reach
 * `networkidle` (late client-side rendering). A page that never goes idle — analytics beacons,
 * websockets, long-polling — keeps the DOM it has when the budget runs out. This replaces
 * "wait for networkidle, on timeout navigate again to domcontentloaded", which paid for a
 * second full load (and, on `proxy-browser`, a second round of proxy bandwidth) and returned
 * a less-rendered DOM than the one it threw away.
 */

type Response = unknown;

export type NavigablePage<R = Response> = {
	goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<R | null>;
	waitForLoadState(state: "networkidle", options: { timeout: number }): Promise<void>;
};

const isTimeout = (error: unknown): boolean => error instanceof Error && error.name === "TimeoutError";

export const navigate = async <R>(
	page: NavigablePage<R>,
	url: string,
	budgetMs: number,
	now: () => number = Date.now,
): Promise<R | null> => {
	const startedAt = now();
	const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: budgetMs });
	const remaining = budgetMs - (now() - startedAt);
	if (remaining > 0) {
		try {
			await page.waitForLoadState("networkidle", { timeout: remaining });
		} catch (error) {
			if (!isTimeout(error)) {
				throw error;
			}
		}
	}
	return response;
};
