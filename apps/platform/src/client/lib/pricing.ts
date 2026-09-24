import { ENGINE_CREDITS, PRICE_TIERS, type PriceTier, monthlyCostUsd, usdPerCredit } from "../../billing/credits";
import type { Engine } from "../../core/types";

/** Paid tiers only — the first is the free allowance. */
export const paidTiers = (): readonly PriceTier[] => PRICE_TIERS.filter((tier) => tier.microUsdPerCredit > 0);

/** Dollars per 1,000 pages of `engine` at a tier's per-credit price. */
export const usdPerThousandPages = (engine: Engine, tier: PriceTier): number =>
	ENGINE_CREDITS[engine] * usdPerCredit(tier) * 1000;

/** "$1.00", "$0.70", and sub-cent per-credit prices like "$0.0007". */
export const formatUsd = (value: number): string => {
	if (value === 0) {
		return "$0";
	}
	return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: value < 0.01 ? 4 : 2 })}`;
};

export type Estimate = { credits: number; monthlyUsd: number; usdPerThousand: number };

/**
 * A month of `auto` traffic: `renderedShare` of the pages escalate to the browser sibling, the
 * rest are served by the fetch tier. With a region, both tiers are the proxy engines.
 */
export const estimateMonth = (params: { pages: number; renderedShare: number; region: boolean }): Estimate => {
	const pages = Math.max(0, Math.round(params.pages));
	const share = Math.min(1, Math.max(0, params.renderedShare));
	const base: Engine = params.region ? "proxy-fetch" : "fetch";
	const rendered: Engine = params.region ? "proxy-browser" : "browser";
	const credits = Math.round(pages * ((1 - share) * ENGINE_CREDITS[base] + share * ENGINE_CREDITS[rendered]));
	const monthlyUsd = monthlyCostUsd(credits);
	return { credits, monthlyUsd, usdPerThousand: pages === 0 ? 0 : (monthlyUsd / pages) * 1000 };
};
