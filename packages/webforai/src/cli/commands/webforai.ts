import fs from "node:fs";
import path from "node:path";
import { cancel, spinner as clackSpinner, confirm, outro, spinner } from "@clack/prompts";
import pc from "picocolors";
import type { Browser as PlaywrightBrowser } from "playwright";
import { $ } from "zx";
import { htmlToMarkdown } from "../../html-to-markdown";
import { inputOutputPath } from "../helpers/inputOutputPath";
import { inputSourcePath } from "../helpers/inputSourcePath";
import { selectExtractMode } from "../helpers/selectExtractMode";
import { selectLoader } from "../helpers/selectLoader";
import { isUrl } from "../utils";

const aiModeOptions = { linkAsText: true, tableAsText: true, hideImage: true };
const readabilityModeOptions = { linkAsText: false, tableAsText: false, hideImage: false };

export type LoaderOptions =
	| { type: "web"; loader: "playwright" | "pw" | "fetch" | string }
	| { type: "local"; loader: null };

const loadHtml = async (sourcePath: string, loader: LoaderOptions) => {
	if (loader.type === "local") {
		const loadSpinner = clackSpinner();
		loadSpinner.start("Retrieving content.");
		if (!fs.existsSync(sourcePath)) {
			console.error(pc.red("The file does not exist"));
			process.exit(1);
		}

		const stats = fs.statSync(sourcePath);
		if (!stats.isFile()) {
			console.error(pc.red("The source must be a file"));
			process.exit(1);
		}

		const content = fs.readFileSync(sourcePath, "utf-8");
		loadSpinner.stop("Content retrieval is complete!");
		return content;
	}

	if (loader.loader === "fetch") {
		const loadSpinner = clackSpinner();
		loadSpinner.start("Downloading content.");
		const { loadHtml } = await import("../../loaders/fetch");
		const content = await loadHtml(sourcePath);
		loadSpinner.stop("Content download is complete!");
		return content;
	}

	if (loader.loader === "playwright") {
		const launchSpinner = clackSpinner();
		launchSpinner.start("Launching playwright.");

		const playwright = await import("playwright");
		let browser: PlaywrightBrowser;

		try {
			browser = await playwright.chromium.launch();
			launchSpinner.stop("Playwright launched!");
		} catch (error) {
			launchSpinner.stop(pc.red("Playwright failed to launch!"));
			if (!(error as Error).message.includes("npx playwright install")) {
				cancel("An unknown error occurred while starting the browser.");
				console.error(error);
				process.exit(1);
			}

			const isInstall = await confirm({
				message: "To continue, you will need to download a browser. Do you wish to continue?",
			});
			if (!isInstall) {
				cancel("End of process.");
				process.exit(1);
			}
			const installDepsSpinner = spinner();
			installDepsSpinner.start("Installing browser dependencies.");

			try {
				await $`npx playwright install`;
				installDepsSpinner.stop("Browser dependencies installed!");
			} catch (error) {
				installDepsSpinner.stop(pc.red("Browser dependencies failed to install!"));
				cancel("End of process.");
				console.error(error);
				process.exit(1);
			}

			browser = await playwright.chromium.launch();
		}
		const loadSpinner = clackSpinner();
		loadSpinner.start("Loading content.");
		const { loadHtml } = await import("../../loaders/playwright");
		const content = await loadHtml(sourcePath, browser);
		loadSpinner.stop("Content download is complete!");

		browser.close();

		return content;
	}

	throw new Error("Invalid loader");
};

export const webforaiCommand = async (
	initialPath: string,
	initialOutputPath: string,
	options: { mode?: string; loader: string; debug?: boolean; baseUrl?: string },
) => {
	const sourcePath = initialPath ?? (await inputSourcePath());
	if (options.debug) {
		console.debug(`sourcePath: ${sourcePath}`);
	}

	const loader: LoaderOptions = isUrl(sourcePath)
		? { type: "web", loader: options.loader ?? (await selectLoader()) }
		: { type: "local", loader: null };
	if (options.debug) {
		console.debug(`loader: ${loader}`);
	}

	const outputPath = initialOutputPath ?? (await inputOutputPath(sourcePath));
	if (options.debug) {
		console.debug(`outputPath: ${outputPath}`);
	}

	const mode = options.mode ?? (await selectExtractMode());
	if (options.debug) {
		console.debug(`mode: ${mode}`);
	}

	const content = await loadHtml(sourcePath, loader);
	if (options.debug) {
		console.debug(`content: ${content}`);
	}

	const markdown = htmlToMarkdown(content, {
		baseUrl: isUrl(sourcePath) ? sourcePath : options.baseUrl,
		...(mode === "ai" ? aiModeOptions : readabilityModeOptions),
	});

	if (options.debug) {
		console.debug(`markdown: ${markdown}`);
	}

	const directory = path.dirname(outputPath);

	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory, { recursive: true });
	}
	fs.writeFileSync(outputPath, markdown);

	outro("Markdown conversion is complete!");
};
