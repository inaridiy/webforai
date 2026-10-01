import { type GoldPage, loadWceb } from "./wceb.js";

/**
 * Named evaluation sets. `wceb` is the only public one; other sets can be registered here by
 * tooling that has its own reference data.
 */
export const loadGoldSets = async (names: string[]): Promise<GoldPage[]> => {
	const pages: GoldPage[] = [];
	for (const name of names) {
		if (name === "wceb") {
			pages.push(...(await loadWceb()));
		} else {
			throw new Error(`Unknown gold set ${name}`);
		}
	}
	return pages;
};
