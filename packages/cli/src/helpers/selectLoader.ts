import { select } from "@clack/prompts";
import { LOADERS } from "../constants";
import { assertContinue } from "./assertContinue";

const loadersHint: Record<(typeof LOADERS)[number], string> = {
	fetch: "Fetch HTML content from the given URL",
	playwright: "Render the page in local headless Chromium first; Playwright must be installed",
	platform: "Convert via the hosted webforai platform API (needs an API key)",
};

export const selectLoader = async () => {
	const result = await select({
		message: "Select loader:",
		initialValue: "fetch",
		options: LOADERS.map((loader) => ({ value: loader as string, label: loader, hint: loadersHint[loader] })),
	});
	assertContinue(result);

	return result;
};
