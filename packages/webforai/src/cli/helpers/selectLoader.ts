import { select } from "@clack/prompts";
import { LOADERS, type Loaders } from "../constants";
import { assertContinue } from "./assertContinue";

const loadersHint = {
	fetch: "Fetch HTML content from the given URL",
	playwright: "Retrieve HTML content after rendering using Playwright; Playwright must be installed in advance.",
	puppeteer: "Retrieve HTML content after rendering using Puppeteer; Puppeteer must be installed in advance.",
} as const;

export const selectLoader = async (initialLoader?: string) => {
	const result = await select({
		message: "Select loader:",
		options: LOADERS.map((mode) => ({ value: mode, label: mode, hint: loadersHint[mode] || "" })),
		initialValue: LOADERS.includes(initialLoader as Loaders) ? initialLoader : "fetch",
	});
	assertContinue(result);

	return result;
};
