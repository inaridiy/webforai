import { intro } from "@clack/prompts";
import { program } from "commander";
import pc from "picocolors";
import packageInfo from "../../package.json";
import { webforaiCommand } from "./commands/handlers";
import { LOADERS, MODES } from "./constants";

program
	.name("webforai")
	.description("CLI tool for ultra-precise HTML to Markdown conversion")
	.version(packageInfo.version, "-v, --version", "output the current version")
	.argument("[source]", "URL or path to process")
	.argument("[outputPath]", "Path to output file or directory")
	.option("--mode <mode>", `Processing mode (${MODES.join(", ")})`)
	.option("--loader <loader>", `Loader to use (${LOADERS.join(", ")})`)
	.option("--baseUrl <baseUrl>", "Base URL for relative links")
	.option("-o, --stdout", "output to stdout")
	.option("-d, --debug", "output extra debugging information")
	.on("option:debug", () => {
		process.env.DEBUG = "true";
	})
	.action(webforaiCommand);

intro(pc.inverse(`webforai CLI version ${packageInfo.version}`));

program.parse();
