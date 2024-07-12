import fs from "node:fs";
import path from "node:path";
import { program } from "commander";
import pc from "picocolors";
import { DEFAULT_EXTRACT_HAST } from "../src/extract-hast";

const packageInfo = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"));

program
	.name("webforai")
	.description("CLI tool for ultra-precise HTML to Markdown conversion")
	.version(packageInfo.version, "-v, --version", "output the current version")
	.argument("[source]", "URL or path to process")
	.argument("[outputPath]", "Path to output file or directory")
	.option("--mode <mode>", "Processing mode (ai or default)", "default")
	.option("--extracter <extracter>", "Extracter to use")
	.option("-d, --debug", "output extra debugging information")
	.on("option:debug", () => {
		process.env.DEBUG = "true";
	})
	.action(async (source, outputPath, options) => {
		try {
			console.info("source", source);
			console.info("outputPath", outputPath);
			console.info("options", options);
		} catch (e) {
			const error = e as Error;

			console.error(pc.red("An error occurred while processing the given value:"), error.message);
			if (process.env.DEBUG) {
				console.error(error.stack);
			}
			process.exit(1);
		}
	});

console.info(pc.gray(`Webfprai CLI version ${packageInfo.version}`));

console.log(DEFAULT_EXTRACT_HAST);
program.parse();
