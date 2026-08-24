import { eq } from "drizzle-orm";

import { createArtifactStore } from "../artifacts/store";
import { createBillingRepo } from "../billing/repo";
import { createStripe } from "../billing/stripe";
import { recordUsage } from "../billing/usage";
import { scrapePage } from "../core/scrape-core";
import type { ScrapeRequest, ScrapeSuccess } from "../core/types";
import { createDb } from "../db/client";
import { user } from "../db/schema";
import { createEngines } from "../engines";
import type { AppConfig } from "../env";

/**
 * The sync-scrape wiring shared by the public `/v1/scrape` route and the session-authenticated
 * dashboard playground.
 *
 * Both surfaces must bill identically — same deps, same "record only after success" rule — so the
 * billing/engine wiring lives here once rather than being copied into each route. The spend guard
 * (`ensureSpendable`) stays in the routes because it runs *before* any side effect; this module
 * owns only the run-and-record half.
 */

/** The Stripe customer of the *authenticated* user; a client-supplied id is never trusted anywhere. */
export const customerIdOf = async (env: Env, userId: string): Promise<string | undefined> => {
	const rows = await createDb(env)
		.select({ stripeCustomerId: user.stripeCustomerId })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return rows[0]?.stripeCustomerId ?? undefined;
};

export const billingDeps = (env: Env, config: AppConfig) => ({ repo: createBillingRepo(createDb(env)), config });

export const scrapeDeps = (env: Env, config: AppConfig) => ({
	engines: createEngines(env, config),
	artifacts: createArtifactStore(env, config),
});

/** `executionCtx` is unavailable outside a real fetch invocation; then the meter call is awaited. */
export const waitUntilOf = (c: {
	executionCtx: { waitUntil(promise: Promise<unknown>): void };
}): ((promise: Promise<unknown>) => void) | undefined => {
	try {
		const ctx = c.executionCtx;
		return (promise) => ctx.waitUntil(promise);
	} catch {
		return undefined;
	}
};

/** The context surface a sync scrape needs: the bindings and (optionally) a `waitUntil`. */
type ScrapeCtx = { env: Env; executionCtx: { waitUntil(promise: Promise<unknown>): void } };

/**
 * Runs one page scrape and records its usage against `userId`.
 *
 * Preconditions: the caller has already run `ensureSpendable` for `userId`. Usage is recorded
 * only here, after a successful scrape, so a thrown scrape is never billed.
 */
export const runSyncScrape = async (
	c: ScrapeCtx,
	config: AppConfig,
	params: { userId: string; request: ScrapeRequest },
): Promise<ScrapeSuccess> => {
	const result = await scrapePage(scrapeDeps(c.env, config), params.request);

	const stripeCustomerId = await customerIdOf(c.env, params.userId);
	await recordUsage(
		{
			repo: createBillingRepo(createDb(c.env)),
			config,
			stripe: createStripe(config),
			waitUntil: waitUntilOf(c),
		},
		// `result.engine`, not the requested one: an `auto` request must record the engine that
		// actually ran (and whose price `result.credits` reflects).
		{ userId: params.userId, stripeCustomerId, operation: result.engine, credits: result.credits },
	);

	return result;
};
