import type { Engine } from "../core/types";

/**
 * Credit schedule and price tiers — the single source of operation pricing.
 * `docs/specs/platform/04_billing.md` mirrors this file, `scripts/stripe-setup.ts` builds the
 * Stripe price from `PRICE_TIERS`, and the landing page and dashboard render from it.
 *
 * Revised 2026-09-24 (owner decision, see 04_billing.md): browser 5→2, proxy-browser 5→3,
 * free allowance 500→1,000, per-credit price $0.002 → graduated $0.001 / $0.0007 / $0.0005.
 */
export const ENGINE_CREDITS: Record<Engine, number> = {
	fetch: 1,
	browser: 2,
	"proxy-fetch": 2,
	// The proxy adds one credit to either tier (fetch 1 → 2, browser 2 → 3). The egress proxy is
	// a flat monthly plan, so its marginal cost per page is tiny; its monthly bandwidth cap is
	// the real limit (04_billing.md).
	"proxy-browser": 3,
};

export const SCREENSHOT_CREDITS = 1;
/** One credit per started batch of 5 rehosted images. */
export const REHOST_IMAGES_PER_CREDIT = 5;

export const creditsFor = (params: { engine: Engine; screenshot: boolean; rehostedImages: number }): number => {
	const screenshot = params.screenshot ? SCREENSHOT_CREDITS : 0;
	const rehost = Math.ceil(params.rehostedImages / REHOST_IMAGES_PER_CREDIT);
	return ENGINE_CREDITS[params.engine] + screenshot + rehost;
};

export type PriceTier = {
	/** Last credit of the calendar month this tier covers; `null` is unbounded. */
	upTo: number | null;
	/** Integer micro-dollars per credit, so the Stripe cents conversion is exact. */
	microUsdPerCredit: number;
};

/** Graduated per-credit prices, per calendar month; the first tier is the free allowance. */
export const PRICE_TIERS: readonly PriceTier[] = [
	{ upTo: 1_000, microUsdPerCredit: 0 },
	{ upTo: 100_000, microUsdPerCredit: 1_000 },
	{ upTo: 1_000_000, microUsdPerCredit: 700 },
	{ upTo: null, microUsdPerCredit: 500 },
];

/** Monthly free allowance for users without an active subscription — the $0 first tier. */
export const FREE_MONTHLY_CREDITS = 1_000;

export const usdPerCredit = (tier: PriceTier): number => tier.microUsdPerCredit / 1_000_000;

/** What a month of `credits` costs under the graduated tiers, in dollars. */
export const monthlyCostUsd = (credits: number): number => {
	let micro = 0;
	let floor = 0;
	for (const tier of PRICE_TIERS) {
		const ceiling = tier.upTo ?? Number.POSITIVE_INFINITY;
		const inTier = Math.max(0, Math.min(credits, ceiling) - floor);
		micro += inTier * tier.microUsdPerCredit;
		floor = ceiling;
		if (credits <= ceiling) {
			break;
		}
	}
	return micro / 1_000_000;
};
