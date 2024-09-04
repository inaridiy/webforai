import fs from "node:fs/promises";
import { cancel, spinner as clackSpinner, confirm, spinner } from "@clack/prompts";
import pc from "picocolors";
import type { Browser as PlaywrightBrowser } from "playwright";
import { $ } from "zx";
import type { LoaderOptions } from "./index";

type LoadSpinner = ReturnType<typeof clackSpinner>;

export const loadHtml = async (sourcePath: string, loader: LoaderOptions): Promise<string> => {
	const loadSpinner = clackSpinner();

	try {
		switch (loader.type) {
			case "local":
				return await loadLocalHtml(sourcePath, loadSpinner);
			case "web":
				switch (loader.loader) {
					case "fetch":
						return await loadFetchHtml(sourcePath, loadSpinner);
					case "playwright":
						return await loadPlaywrightHtml(sourcePath, loadSpinner);
					default:
						throw new Error("Invalid loader");
				}
			default:
				throw new Error("Invalid loader type");
		}
	} catch (error) {
		loadSpinner.stop(pc.red("Content loading failed!"));
		console.error(error);
		process.exit(1);
	}
};

const loadLocalHtml = async (sourcePath: string, loadSpinner: LoadSpinner): Promise<string> => {
	loadSpinner.start("Retrieving content.");
	try {
		await fs.access(sourcePath);
	} catch {
		throw new Error("The file does not exist");
	}

	const stats = await fs.stat(sourcePath);
	if (!stats.isFile()) {
		throw new Error("The source must be a file");
	}

	const content = await fs.readFile(sourcePath, "utf-8");
	loadSpinner.stop("Content retrieval is complete!");
	return content;
};

const loadFetchHtml = async (sourcePath: string, loadSpinner: LoadSpinner): Promise<string> => {
	loadSpinner.start("Downloading content.");
	const { loadHtml } = await import("../../../loaders/fetch");
	const content = await loadHtml(sourcePath);
	loadSpinner.stop("Content download is complete!");
	return content;
};

const loadPlaywrightHtml = async (sourcePath: string, loadSpinner: LoadSpinner): Promise<string> => {
	const launchSpinner = clackSpinner();
	launchSpinner.start("Launching playwright.");

	const playwright = await import("playwright");
	let browser: PlaywrightBrowser;

	try {
		browser = await playwright.chromium.launch();
		launchSpinner.stop("Playwright launched!");
	} catch (error) {
		await handlePlaywrightLaunchError(error as Error);
		browser = await playwright.chromium.launch();
	}

	loadSpinner.start("Loading content.");
	const { loadHtml } = await import("../../../loaders/playwright");
	const content = await loadHtml(sourcePath, browser);
	loadSpinner.stop("Content download is complete!");

	await browser.close();

	return content;
};

const handlePlaywrightLaunchError = async (error: Error): Promise<void> => {
	if (!error.message.includes("npx playwright install")) {
		throw error;
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
		throw error;
	}
};
