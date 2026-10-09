import { select } from "@clack/prompts";
import { MODES } from "../constants";
import { assertContinue } from "./assertContinue";

export const selectExtractMode = async () => {
	const result = await select({
		message: "Select processing mode:",
		options: MODES.map((mode) => ({ value: mode as string, label: mode as string })),
		initialValue: MODES[0] as string,
	});

	assertContinue(result);

	return result;
};
