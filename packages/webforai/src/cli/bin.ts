import { intro } from "@clack/prompts";
import { program } from "commander";
import pc from "picocolors";
import packageInfo from "../../package.json";
import { webforaiCommand } from "./commands/webforai";
import { LOADERS, MODES } from "./constants";

program
	.name("webforai")
	.description("CLI tool for ultra-precise HTML to Markdown conversion")
	.version(packageInfo.version, "-v, --version", "output the current version");

program
	.argument("[source]", "URL or path to process")
	.option("-o, --output <output>", "Path to output file or directory")
	.option("-m, --mode <mode>", `Processing mode (${MODES.join(", ")})`)
	.option("-l, --loader <loader>", `Loader to use (${LOADERS.join(", ")})`)
	.option("-d, --debug", "output extra debugging information")
	.action(webforaiCommand);

intro(pc.inverse(`webforai CLI version ${packageInfo.version}`));

program.parse();
