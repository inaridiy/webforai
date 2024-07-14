import fs from "node:fs";
import path from "node:path";
import { spinner as clackSpinner, spinner } from "@clack/prompts";
import pc from "picocolors";
import { htmlToMarkdown } from "../../html-to-markdown";
import { inputOutputPath } from "../helpers/inputOutputPath";
import { inputSourcePath } from "../helpers/inputSourcePath";
import { requirePackage } from "../helpers/requirePackage";
import { selectExtractMode } from "../helpers/selectExtractMode";
import { selectLoader } from "../helpers/selectLoader";
import { isUrl } from "../utils";

const aiModeOptions = { linkAsText: true, tableAsText: true, hideImage: true };
const readabilityModeOptions = { linkAsText: false, tableAsText: false, hideImage: false };

type LoaderOptions = { type: "web"; loader: string } | { type: "local"; loader: null };

const loadHtml = async (sourcePath: string, loader: LoaderOptions) => {
	const loadSpinner = clackSpinner();

	if (loader.type === "local") {
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

	loadSpinner.start("Downloading content.");

	if (loader.loader === "playwright") {
		await requirePackage("playwright");
		const { loadHtml } = await import("../../loaders/playwright");
		const content = await loadHtml(sourcePath);
		loadSpinner.stop("Content download is complete!");
		return content;
	}
	if (loader.loader === "puppeteer") {
		await requirePackage("puppeteer");
		const { loadHtml } = await import("../../loaders/puppeteer");
		const content = await loadHtml(sourcePath);
		loadSpinner.stop("Content download is complete!");
		return content;
	}

	const { loadHtml } = await import("../../loaders/fetch");

	const content = await loadHtml(sourcePath);
	loadSpinner.stop("Content download is complete!");
	return content;
};

export const webforaiCommand = async (
	initialPath: string,
	initialOutputPath: string,
	options: { mode?: string; loader: string; debug?: boolean; baseUrl?: string; stdout?: boolean },
) => {
	const sourcePath = await inputSourcePath(initialPath);

	const loader: LoaderOptions = isUrl(sourcePath)
		? { type: "web", loader: await selectLoader(options.loader) }
		: { type: "local", loader: null };

	const outputPath = options.stdout ? await inputOutputPath(sourcePath, initialOutputPath) : null;

	const mode = await selectExtractMode(options.mode);

	const content = await loadHtml(sourcePath, loader);

	const convertSpinner = spinner();
	convertSpinner.start("Converting content to markdown.");

	const markdown = htmlToMarkdown(content, {
		baseUrl: isUrl(sourcePath) ? sourcePath : options.baseUrl,
		...(mode === "ai" ? aiModeOptions : readabilityModeOptions),
	});

	if (!outputPath) {
		console.info(markdown);
		return;
	}

	const directory = path.dirname(outputPath);

	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory, { recursive: true });
	}
	fs.writeFileSync(outputPath, markdown);

	convertSpinner.stop("Markdown conversion is complete!");
};
