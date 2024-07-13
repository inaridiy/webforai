import { select } from "@clack/prompts";
import { MODES } from "../constants";
import { assertContinue } from "./assertContinue";

export const selectExtractMode = async (initialMode?: string) => {
	const result = await select({
		message: "Select processing mode:",
		options: MODES.map((mode) => ({ value: mode, label: mode })),
		initialValue: MODES.includes(initialMode ?? "") ? initialMode : "default",
	});

	assertContinue(result);

	return result;
};
