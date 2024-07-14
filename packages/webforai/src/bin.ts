import { intro } from "@clack/prompts";
import { program } from "commander";
import pc from "picocolors";
import packageInfo from "../package.json" assert { type: "json" };
import { webforaiCommand } from "./cli/commands/webforai";
import { LOADERS, MODES } from "./cli/constants";

program
	.name("webforai")
	.description("CLI tool for ultra-precise HTML to Markdown conversion")
	.version(packageInfo.version, "-v, --version", "output the current version")
	.argument("[source]", "URL or path to process")
	.argument("[outputPath]", "Path to output file or directory")
	.option("--mode <mode>", `Processing mode (${MODES.join(", ")})`, MODES[0])
	.option("--loader <loader>", `Loader to use (${LOADERS.join(", ")})`, LOADERS[0])
	.option("--baseUrl <baseUrl>", "Base URL for relative links")
	.option("-o, --stdout", "output to stdout")
	.option("-d, --debug", "output extra debugging information")
	.on("option:debug", () => {
		process.env.DEBUG = "true";
	})
	.action(webforaiCommand);

intro(pc.inverse(`webforai CLI version ${packageInfo.version}`));

program.parse();
