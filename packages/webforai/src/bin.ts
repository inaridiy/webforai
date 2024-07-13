import fs from "node:fs";
import { cancel, confirm, intro, isCancel, outro, select, spinner, text } from "@clack/prompts";
import { program } from "commander";
import pc from "picocolors";
import packageInfo from "../package.json" assert { type: "json" };
import { htmlToMarkdown } from "./html-to-markdown";
import { loadHtml as playwrightLoadHtml } from "./loaders/playwright";
import { loadHtml as puppeteerLoadHtml } from "./loaders/puppeteer";
import { getNextAvailableFilePath, isUrl } from "./utils/bin-utils";

const MODES: string[] = ["default", "ai"];
const LOADERS: string[] = ["fetch", "playwright", "puppeteer"];

const loadersHint: { [name: string]: string } = {
	fetch: "Fetch HTML content from the given URL",
	playwright: "Retrieve HTML content after rendering using Playwright; Playwright must be installed in advance.",
	puppeteer: "Retrieve HTML content after rendering using Puppeteer; Puppeteer must be installed in advance.",
};
const aiModeOptions = { linkAsText: true, tableAsText: true, hideImage: true };
const readabilityModeOptions = { linkAsText: false, tableAsText: false, hideImage: false };

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
	.action(
		async (
			source: string,
			outputPath: string,
			options: { mode?: string; loader?: string; debug?: boolean; baseUrl?: string; stdout?: boolean },
			// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
		) => {
			let finalSource: string | symbol;
			let sourceIsUrl: boolean | symbol;
			let finalOutputPath: string | symbol;
			let finalMode: string | symbol;
			let finalLoader: string | symbol = "fetch";
			const isOutputFile = !options.stdout;

			if (process.env.DEBUG) {
				console.info("Arguments and options:");
				console.table({
					source,
					outputPath,
					...options,
				});
				console.info("isOutputFile:", isOutputFile);
			}

			try {
				// Determine if source is URL or path
				finalSource = await text({
					message: "Enter the URL or html path to be converted to markdown:",
					placeholder: "https://example.com",
					initialValue: source,
					validate: (value: string) => {
						if (value.trim() === "") {
							return "Source is required";
						}
					},
				});
				if (isCancel(finalSource)) {
					cancel("Canceled.");
					return;
				}
				sourceIsUrl = isUrl(finalSource);

				// Select loader
				if (sourceIsUrl) {
					finalLoader = await select({
						message: "Select loader:",
						options: LOADERS.map((mode) => ({ value: mode, label: mode, hint: loadersHint[mode] || "" })),
						initialValue: options.loader && LOADERS.includes(options.loader) ? options.loader : "fetch",
					});
					if (isCancel(finalLoader)) {
						cancel("Canceled.");
						return;
					}
				}

				if (isOutputFile) {
					// Determine output path
					finalOutputPath = await text({
						message: "Enter the output file path:",
						placeholder: "output.md",
						initialValue: outputPath ? outputPath : "output.md",
						validate: (value: string) => {
							if (value.trim() === "") {
								return "Output path is required";
							}
						},
					});
					if (isCancel(finalOutputPath)) {
						cancel("Canceled.");
						return;
					}

					if (fs.existsSync(finalOutputPath)) {
						const isOutputFileOverwrite = await confirm({
							message: "The file already exists. Overwrite?",
							initialValue: false,
						});
						if (isCancel(isOutputFileOverwrite)) {
							cancel("Canceled.");
							return;
						}

						if (isOutputFileOverwrite === false) {
							finalOutputPath = await text({
								message: "Enter the output file path:",
								placeholder: "output.md",
								initialValue: getNextAvailableFilePath(finalOutputPath),
								validate: (value: string) => {
									if (value.trim() === "") {
										return "Output path is required";
									}

									if (fs.existsSync(value)) {
										return "The file already exists";
									}
								},
							});
							if (isCancel(finalOutputPath)) {
								cancel("Canceled.");
								return;
							}
						}
					}
				} else {
					finalOutputPath = "";
				}

				// Select mode
				finalMode = await select({
					message: "Select processing mode:",
					options: MODES.map((mode) => ({ value: mode, label: mode })),
					initialValue: options.mode && MODES.includes(options.mode) ? options.mode : "default",
				});
				if (isCancel(finalMode)) {
					cancel("Canceled.");
					return;
				}
			} catch (e) {
				const error = e as Error;

				console.error(pc.red("An error occurred while processing the given value:"), error.message);
				if (process.env.DEBUG) {
					console.error(error.stack);
				}
				process.exit(1);
			}

			if (process.env.DEBUG) {
				console.info("Processing with the following options:");
				console.table({ finalSource, sourceIsUrl, isOutputFile, finalOutputPath, finalMode, finalLoader });
			}

			let content: string;

			const loadSpinner = spinner();
			try {
				if (sourceIsUrl) {
					loadSpinner.start("Downloading content.");

					if (finalLoader === "playwright") {
						content = await playwrightLoadHtml(finalSource);
					} else if (finalLoader === "puppeteer") {
						content = await puppeteerLoadHtml(finalSource);
					} else {
						const response = await fetch(finalSource);

						content = await response.text();
					}

					loadSpinner.stop("Content download is complete!");
				} else {
					loadSpinner.start("Retrieving content.");
					if (!fs.existsSync(finalSource)) {
						console.error(pc.red("The file does not exist"));
						process.exit(1);
					}

					const stats = fs.statSync(finalSource);
					if (!stats.isFile()) {
						console.error(pc.red("The source must be a file"));
						process.exit(1);
					}

					content = fs.readFileSync(finalSource, "utf-8");
					loadSpinner.stop("Content retrieval is complete!");
				}
			} catch (e) {
				const error = e as Error;

				loadSpinner.stop(pc.red("An error occurred while retrieving content"));

				console.error(error.message);
				if (process.env.DEBUG) {
					console.error(error.stack);
				}
				process.exit(1);
			}

			if (process.env.DEBUG) {
				console.info("Content:");
				console.info(content);
			}

			const convertSpinner = spinner();
			try {
				convertSpinner.start("Converting content to markdown.");

				const markdown = htmlToMarkdown(content, {
					...(sourceIsUrl || (!!options.baseUrl && options.baseUrl.trim() !== "")
						? { baseUrl: options.baseUrl || finalSource }
						: {}),
					...(finalMode === "ai" ? aiModeOptions : readabilityModeOptions),
				});

				if (process.env.DEBUG) {
					console.info("Markdown:");
					console.info(markdown);
				}

				if (isOutputFile) {
					fs.writeFileSync(finalOutputPath, markdown);

					convertSpinner.stop("Markdown conversion is complete!");

					outro(`Converted successfully to markdown! Output saved to: ${finalOutputPath} 🎉`);
				} else {
					convertSpinner.stop("Markdown conversion is complete!");
					outro("Converted successfully to markdown🎉");
					// biome-ignore lint/suspicious/noConsoleLog: <explanation>
					console.log(`\n\n${markdown}`);
				}
			} catch (e) {
				const error = e as Error;

				convertSpinner.stop(pc.red("An error occurred while converting and saving the markdown"));

				console.error(error.message);
				if (process.env.DEBUG) {
					console.error(error.stack);
				}
				process.exit(1);
			}
		},
	);

intro(pc.inverse(`webforai CLI version ${packageInfo.version}`));

program.parse();
