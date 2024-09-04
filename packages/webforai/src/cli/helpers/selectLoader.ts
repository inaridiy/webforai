import { select } from "@clack/prompts";
import { LOADERS } from "../constants";
import { assertContinue } from "./assertContinue";

const loadersHint = {
	fetch: "Fetch HTML content from the given URL",
	playwright: "Retrieve HTML content after rendering using Playwright; Playwright must be installed in advance.",
	puppeteer: "Retrieve HTML content after rendering using Puppeteer; Puppeteer must be installed in advance.",
} as const;

export const selectLoader = async () => {
	const result = await select({
		message: "Select loader:",
		initialValue: "fetch",
		options: LOADERS.map((mode) => ({ value: mode, label: mode, hint: loadersHint[mode] || "" })),
	});
	assertContinue(result);

	return result;
};
