import fs from "node:fs";
import { confirm, text } from "@clack/prompts";
import { getNextAvailableFilePath, sourcePathToOutputPath } from "../utils";
import { assertContinue } from "./assertContinue";

export const inputOutputPath = async (sourcePath: string) => {
	const outputPath = await text({
		message: "Enter the output file path:",
		placeholder: "output.md",
		initialValue: sourcePathToOutputPath(sourcePath),
		validate: (value: string) => {
			if (value.trim() === "") {
				return "Output path is required";
			}
			if (fs.existsSync(value) && fs.statSync(value).isDirectory()) {
				return "No directory can be specified.";
			}
			if (!fs.existsSync(value) && value.endsWith("/")) {
				return "No directory can be specified.";
			}
		},
	});
	assertContinue(outputPath);

	if (!fs.existsSync(outputPath)) {
		return outputPath;
	}

	const isOutputFileOverwrite = await confirm({
		message: "The file already exists. Overwrite?",
		initialValue: false,
	});
	assertContinue(isOutputFileOverwrite);

	if (isOutputFileOverwrite) {
		return outputPath;
	}

	const escapedOutputPath = await text({
		message: "Enter the output file path:",
		placeholder: "output.md",
		initialValue: getNextAvailableFilePath(outputPath),
		validate: (value: string) => {
			if (value.trim() === "") {
				return "Output path is required";
			}
			if (fs.existsSync(value)) {
				return "The file already exists";
			}
			if (!fs.existsSync(value) && value.endsWith("/")) {
				return "No directory can be specified.";
			}
		},
	});

	assertContinue(escapedOutputPath);

	return escapedOutputPath;
};
