import { describe, expect, it } from "vitest";
import { estimateMonth, formatUsd, paidTiers, usdPerThousandPages } from "./pricing";

describe("pricing helpers", () => {
	it("prices 1,000 pages per engine at the first paid tier", () => {
		const [first] = paidTiers();
		if (first === undefined) {
			throw new Error("expected a paid tier");
		}
		expect(usdPerThousandPages("fetch", first)).toBeCloseTo(1, 10);
		expect(usdPerThousandPages("browser", first)).toBeCloseTo(2, 10);
		expect(usdPerThousandPages("proxy-browser", first)).toBeCloseTo(3, 10);
	});

	it("formats dollars and sub-cent per-credit prices", () => {
		expect(formatUsd(0)).toBe("$0");
		expect(formatUsd(1)).toBe("$1.00");
		expect(formatUsd(1234.5)).toBe("$1,234.50");
		expect(formatUsd(0.0007)).toBe("$0.0007");
		expect(formatUsd(0.001)).toBe("$0.001");
	});

	it("estimates a month of auto traffic with the free allowance applied", () => {
		// 50,000 pages, 20% rendered: 40,000 × 1 + 10,000 × 2 = 60,000 credits → 59,000 × $0.001
		const month = estimateMonth({ pages: 50_000, renderedShare: 0.2, region: false });
		expect(month.credits).toBe(60_000);
		expect(month.monthlyUsd).toBeCloseTo(59, 10);
		expect(month.usdPerThousand).toBeCloseTo(1.18, 10);
		expect(estimateMonth({ pages: 500, renderedShare: 0.2, region: false }).monthlyUsd).toBe(0);
		expect(estimateMonth({ pages: 1_000, renderedShare: 0, region: true }).credits).toBe(2_000);
		expect(estimateMonth({ pages: 0, renderedShare: 0.5, region: false }).usdPerThousand).toBe(0);
	});
});
