import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { log } from "@clack/prompts";
import boxen from "boxen";
import pc from "picocolors";
import { chromium } from "playwright-core";
import { loadHtml as loadHtmlByFetch } from "../../../loaders/fetch";
import { loadHtml as loadHtmlByPlaywright } from "../../../loaders/playwright";

const checkPlaywrightAvailable = async () => {
	const path = chromium.executablePath();
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
};

const getPlaywrightVersion = async () => {
	const path = await import.meta.resolve("playwright-core/package.json");
	const pwPackageJson = await fs
		.readFile(fileURLToPath(path), "utf-8")
		.then((res) => JSON.parse(res.toString()))
		.catch(() => null);
	return pwPackageJson?.version;
};

export const loadHtml = async (sourcePath: string, loader: string, options: { debug?: boolean }) => {
	if (loader === "local") {
		options.debug && log.info(`Loading HTML from local file: ${sourcePath}`);
		const content = await fs.readFile(sourcePath, "utf-8");
		options.debug && log.info(`HTML loaded: ${content.slice(0, 100)}`);
		return content;
	}

	if (loader === "fetch") {
		options.debug && log.info(`Loading HTML from URL: ${sourcePath}`);
		const content = await loadHtmlByFetch(sourcePath);
		options.debug && log.info(`HTML loaded: ${content.slice(0, 100)}`);
		return content;
	}

	if (loader === "playwright") {
		options.debug && log.info(`Loading HTML from playwright: ${sourcePath}`);
		const isPlaywrightAvailable = await checkPlaywrightAvailable();
		options.debug && log.info(`Playwright available: ${isPlaywrightAvailable}`);

		const pwVersion = await getPlaywrightVersion();

		if (!isPlaywrightAvailable) {
			const message = [
				pc.bold("Error: Playwright is not available"),
				"",
				"To use the Playwright loader, please install Playwright by running:",
				"",
				`  npx playwright@${pwVersion} install chromium`,
				"",
				"Hint 1: If you receive a warning like this:",
				`  "WARNING: It looks like you are running 'npx playwright install' without first installing your project's dependencies."`,
				"You can safely ignore this warning.",
				"",
				"Hint 2: If you encounter the following message:",
				`  "Host system is missing dependencies to run browsers."`,
				"You should install the necessary dependencies by executing:",
				"",
				`  sudo npx playwright@${pwVersion} install-deps`,
			];

			log.error(boxen(message.join("\n"), { padding: 1, borderStyle: "round" }));
			throw new Error("Playwright is not available");
		}
		const content = await loadHtmlByPlaywright(sourcePath);
		options.debug && log.info(`HTML loaded: ${content.slice(0, 100)}`);
		return content;
	}

	throw new Error(`Unsupported loader: ${loader}`);
};
