import { z } from "zod";
import type { Region } from "../core/regions";
import type { RequestedEngine } from "../core/types";
import { PlatformError } from "../core/types";
import type { AppConfig } from "../env";
import { FREE_MONTHLY_CREDITS, monthlyCostMicroUsd } from "./credits";
import type { BillingRepo } from "./repo";
import { isSpendable } from "./state";

export interface BillingDeps {
	repo: BillingRepo;
	config: AppConfig;
}

/** Monthly spend cap a subscriber gets until they set their own (owner decision 2026-10-01). */
export const DEFAULT_SPEND_CAP_USD = 50;
export const MIN_SPEND_CAP_USD = 1;
export const MAX_SPEND_CAP_USD = 5_000;

/** `PUT /api/dashboard/billing/spend-cap` body: whole dollars, no "unlimited". */
export const spendCapBodySchema = z.object({
	spendCapUsd: z.number().int().min(MIN_SPEND_CAP_USD).max(MAX_SPEND_CAP_USD),
});

/** The cap in force for a stored value (`null`/absent means the default). */
export const effectiveSpendCapUsd = (stored: number | null | undefined): number => stored ?? DEFAULT_SPEND_CAP_USD;

/** Start of the current calendar month in UTC — the window the free allowance resets on. */
export const monthStart = (now: Date = new Date()): Date =>
	new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * Whether a request runs on the proxy tier: an explicit proxy engine, or `auto` pinned to it by
 * a non-`auto` region (`resolveAuto` in `core/scrape-core.ts`). Concrete `fetch`/`browser`
 * ignore a region, so they stay on the free tier whatever the region says.
 */
export const usesProxyTier = (request: { engine: RequestedEngine; region?: Region | undefined }): boolean => {
	if (request.engine === "proxy-fetch" || request.engine === "proxy-browser") return true;
	return request.engine === "auto" && request.region !== undefined && request.region !== "auto";
};

/** Where every billing error sends the user. */
export const dashboardUrl = (config: Pick<AppConfig, "BASE_URL">): string =>
	`${config.BASE_URL.replace(/\/+$/, "")}/dashboard`;

export interface SpendOptions {
	/** The operation runs on the proxy tier (`usesProxyTier`) — subscribers only. */
	proxy?: boolean;
	now?: Date;
}

/**
 * Fail-closed spend guard, run **before** any side effect (and before every job page).
 *
 * - Proxy-tier requests need an active subscription when billing is configured: the free
 *   allowance covers `fetch`/`browser`/`auto` only (owner decision 2026-10-01).
 * - An active subscription spends until this UTC calendar month's estimated bill would pass the
 *   user's spend cap (default $50) — refused once one more credit would cross it. The check
 *   reads committed usage, so the cap (and the free allowance) can be overshot by the
 *   operations admitted concurrently — bounded by the per-minute limit and a few credits each,
 *   cents in practice; an atomic reservation would remove it (deferred, 2026-10-01 review).
 * - Everyone else — including every user of a self-hosted deployment without Stripe — is capped
 *   at the free monthly allowance.
 *
 * Usage is read from the local D1 ledger so the hot path never calls Stripe.
 */
export const ensureSpendable = async (deps: BillingDeps, userId: string, options: SpendOptions = {}): Promise<void> => {
	const now = options.now ?? new Date();
	const state = await deps.repo.getBillingState(userId);
	// A subscription only counts while billing is configured: with Stripe gone, usage can no
	// longer be reported, so a stale `active` mirror must not unlock paid spending.
	const subscribed = deps.config.billingEnabled && isSpendable(state);

	if (options.proxy && deps.config.billingEnabled && !subscribed) {
		throw new PlatformError(
			"payment_required",
			`Proxy engines (proxy-fetch, proxy-browser, or a region such as "jp") need an active subscription. Start one at ${dashboardUrl(
				deps.config,
			)}.`,
			402,
		);
	}

	const used = await deps.repo.sumMonthCredits(userId, monthStart(now));

	if (subscribed) {
		const capUsd = effectiveSpendCapUsd(state?.spendCapUsd);
		if (monthlyCostMicroUsd(used + 1) > capUsd * 1_000_000) {
			throw new PlatformError(
				"spend_cap_reached",
				`This month's estimated bill has reached your $${capUsd} spend cap. Raise the cap at ${dashboardUrl(
					deps.config,
				)}.`,
				402,
			);
		}
		return;
	}

	if (used < FREE_MONTHLY_CREDITS) return;

	throw new PlatformError(
		"payment_required",
		deps.config.billingEnabled
			? `Free monthly allowance of ${FREE_MONTHLY_CREDITS} credits is used up. Start a subscription at ${dashboardUrl(
					deps.config,
				)}.`
			: `Free monthly allowance of ${FREE_MONTHLY_CREDITS} credits is used up and billing is not configured on this deployment.`,
		402,
	);
};

/**
 * The keyless public demo is unbilled, so it must never spend proxy bandwidth: a non-`auto`
 * region would pin its `auto` engine to the proxy tier. Call before the cache and the limiter.
 */
export const assertDemoRegionAllowed = (region: Region, dashboard: string): void => {
	if (region === "auto") return;
	throw new PlatformError(
		"payment_required",
		`Region "${region}" runs on the paid proxy tier and is not part of the free demo. Use it from the API with a subscription: ${dashboard}.`,
		402,
	);
};
