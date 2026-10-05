import { describe, expect, it } from "vitest";

import { EXTRACTOR_PRESETS } from "../preset-names";
import { agentExtractor } from "./agent";
import { readabilityExtractor } from "./auto";
import { presetExtractors } from "./by-name";
import { kiwameExtractor } from "./kiwame";
import { minimalFilter } from "./minimal-filter";
import { takumiExtractor } from "./takumi";

describe("presetExtractors", () => {
	it("maps every preset name to its extractor", () => {
		expect(EXTRACTOR_PRESETS.map(presetExtractors)).toEqual([
			undefined,
			readabilityExtractor,
			agentExtractor,
			kiwameExtractor,
			takumiExtractor,
			minimalFilter,
			false,
		]);
		expect(presetExtractors(undefined)).toBeUndefined();
	});
});
