import fs from "node:fs/promises";
import pc from "picocolors";
import { chromium } from "playwright";
import playwrightPackageJson from "playwright/package.json";
import { loadHtml as loadHtmlByFetch } from "../../../loaders/fetch";
import { loadHtml as loadHtmlByPlaywright } from "../../../loaders/playwright";

const checkPlaywrightAvailable = async () => {
	const path = chromium.executablePath();
	const isAvailable = await fs.access(path).catch(() => false);
	return !!isAvailable;
};

export const loadHtml = async (sourcePath: string, loader: string, options: { debug?: boolean }) => {
	if (loader === "local") {
		options.debug && console.debug(`Loading HTML from local file: ${sourcePath}`);
		const content = await fs.readFile(sourcePath, "utf-8");
		options.debug && console.debug(`HTML loaded: ${content.slice(0, 100)}`);
		return content;
	}

	if (loader === "fetch") {
		options.debug && console.debug(`Loading HTML from URL: ${sourcePath}`);
		const content = await loadHtmlByFetch(sourcePath);
		options.debug && console.debug(`HTML loaded: ${content.slice(0, 100)}`);
		return content;
	}

	if (loader === "playwright") {
		options.debug && console.debug(`Loading HTML from playwright: ${sourcePath}`);
		const isPlaywrightAvailable = await checkPlaywrightAvailable();
		options.debug && console.debug(`Playwright available: ${isPlaywrightAvailable}`);
		if (!isPlaywrightAvailable) {
			const message = [
				"To use playwright loader, you need to install playwright.",
				"You can install it by running:",
				"",
				`	${pc.bold(`npx playwright@${playwrightPackageJson.version} install chromium`)}	`,
				"",
				"Hint1: If you get warning like this:",
				"WARNING: It looks like you are running 'npx playwright install' without first installing your project's dependencies. ",
				`${pc.bold("Ignore this warning.")}`,
				"",
				"Hint2: If you get message like this:",
				"Host system is missing dependencies to run browsers.",
				"You should install dependencies by running:",
				"",
				`	${pc.bold(`sudo npx playwright@${playwrightPackageJson.version} install-deps`)}	`,
				"",
				pc.gray("Note: Good luck with that."),
			];
			console.info(message.join("\n"));
			throw new Error("Playwright is not available");
		}
		const content = await loadHtmlByPlaywright(sourcePath);
		options.debug && console.debug(`HTML loaded: ${content.slice(0, 100)}`);
		return content;
	}

	throw new Error(`Unsupported loader: ${loader}`);
};
