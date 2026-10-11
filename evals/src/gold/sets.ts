import { type GoldPage, loadWceb } from "./wceb.js";
import { loadWcxb } from "./wcxb.js";
import { loadWebMainBench } from "./webmainbench.js";

/**
 * Named evaluation sets, all public: `wceb`, `wcxb-test`, `wcxb-dev` and `webmainbench`. Other sets
 * can be registered here by tooling that has its own reference data.
 */
export const loadGoldSets = async (names: string[]): Promise<GoldPage[]> => {
	const pages: GoldPage[] = [];
	for (const name of names) {
		if (name === "wceb") {
			pages.push(...(await loadWceb()));
		} else if (name === "wcxb-test" || name === "wcxb-dev") {
			pages.push(...(await loadWcxb(name === "wcxb-test" ? "test" : "dev")));
		} else if (name === "webmainbench") {
			pages.push(...(await loadWebMainBench()));
		} else {
			throw new Error(`Unknown gold set ${name}`);
		}
	}
	return pages;
};
