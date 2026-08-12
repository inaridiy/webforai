import { describe, expect, it } from "vitest";

import { buildProxyUsername } from "../engines/proxy-username";
import { REGIONS, REGION_COUNTRY, type Region, regionToCountry } from "./regions";

describe("regions", () => {
	it("maps every region except auto to a country", () => {
		expect(regionToCountry("us")).toBe("US");
		expect(regionToCountry("eu")).toBe("DE");
		expect(regionToCountry("uk")).toBe("GB");
		expect(regionToCountry("jp")).toBe("JP");
		expect(regionToCountry("asia")).toBe("SG");
	});

	it("treats auto as no geo-targeting", () => {
		expect(regionToCountry("auto")).toBeUndefined();
	});

	it("covers the whole enum, so a new region cannot silently fall back to auto", () => {
		const targetable = REGIONS.filter((region): region is Exclude<Region, "auto"> => region !== "auto");
		expect(Object.keys(REGION_COUNTRY).sort()).toEqual([...targetable].sort());
		for (const region of targetable) {
			expect(regionToCountry(region)).toMatch(/^[A-Z]{2}$/);
		}
	});
});

describe("buildProxyUsername", () => {
	it("appends -rotate when no country is targeted", () => {
		expect(buildProxyUsername("rqzaprfb")).toBe("rqzaprfb-rotate");
		expect(buildProxyUsername("rqzaprfb", undefined)).toBe("rqzaprfb-rotate");
	});

	it("inserts the country before -rotate", () => {
		expect(buildProxyUsername("rqzaprfb", "US")).toBe("rqzaprfb-US-rotate");
		expect(buildProxyUsername("rqzaprfb", "JP")).toBe("rqzaprfb-JP-rotate");
	});

	it("does not double-append when the configured username already ends in -rotate", () => {
		expect(buildProxyUsername("rqzaprfb-rotate")).toBe("rqzaprfb-rotate");
		expect(buildProxyUsername("rqzaprfb-rotate", "DE")).toBe("rqzaprfb-DE-rotate");
	});

	it("is idempotent when the username already carries the same country", () => {
		expect(buildProxyUsername("rqzaprfb-GB-rotate", "GB")).toBe("rqzaprfb-GB-rotate");
		expect(buildProxyUsername("rqzaprfb-GB", "GB")).toBe("rqzaprfb-GB-rotate");
	});

	it("builds exactly what regionToCountry resolves to", () => {
		expect(buildProxyUsername("user", regionToCountry("uk"))).toBe("user-GB-rotate");
		expect(buildProxyUsername("user", regionToCountry("auto"))).toBe("user-rotate");
	});
});
