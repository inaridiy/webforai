import { describe, expect, it } from "vitest";
import { ENGINE_CREDITS, FREE_MONTHLY_CREDITS, PRICE_TIERS, creditsFor, monthlyCostUsd } from "./credits";

describe("credit schedule", () => {
	it("prices each engine per the 2026-09-24 schedule", () => {
		expect(ENGINE_CREDITS).toEqual({ fetch: 1, browser: 2, "proxy-fetch": 2, "proxy-browser": 10 });
		expect(creditsFor({ engine: "browser", screenshot: true, rehostedImages: 6 })).toBe(2 + 1 + 2);
	});

	it("keeps the free allowance equal to the $0 first tier Stripe bills", () => {
		expect(PRICE_TIERS[0]).toEqual({ upTo: FREE_MONTHLY_CREDITS, microUsdPerCredit: 0 });
	});

	it("orders tiers by ceiling and ends unbounded", () => {
		const ceilings = PRICE_TIERS.map((tier) => tier.upTo);
		expect(ceilings.at(-1)).toBeNull();
		const bounded = ceilings.slice(0, -1) as number[];
		expect(bounded).toEqual([...bounded].sort((a, b) => a - b));
	});
});

describe("monthlyCostUsd", () => {
	it("is free within the allowance", () => {
		expect(monthlyCostUsd(0)).toBe(0);
		expect(monthlyCostUsd(1_000)).toBe(0);
	});

	it("applies each tier only to the credits inside it", () => {
		expect(monthlyCostUsd(1_001)).toBeCloseTo(0.001, 10);
		// 99,000 × $0.001
		expect(monthlyCostUsd(100_000)).toBeCloseTo(99, 10);
		// 99,000 × $0.001 + 900,000 × $0.0007
		expect(monthlyCostUsd(1_000_000)).toBeCloseTo(99 + 630, 10);
		// … + 1,000,000 × $0.0005
		expect(monthlyCostUsd(2_000_000)).toBeCloseTo(99 + 630 + 500, 10);
	});
});
