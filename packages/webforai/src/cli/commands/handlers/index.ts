import fs from "node:fs";
import path from "node:path";
import { outro } from "@clack/prompts";
import { htmlToMarkdown } from "../../../html-to-markdown";
import { inputOutputPath } from "../../helpers/inputOutputPath";
import { inputSourcePath } from "../../helpers/inputSourcePath";
import { selectExtractMode } from "../../helpers/selectExtractMode";
import { selectLoader } from "../../helpers/selectLoader";
import { isUrl } from "../../utils";
import { loadHtml } from "./loadHtml";

const aiModeOptions = { linkAsText: true, tableAsText: true, hideImage: true };
const readabilityModeOptions = { linkAsText: false, tableAsText: false, hideImage: false };

export type LoaderOptions =
	| { type: "web"; loader: "playwright" | "pw" | "fetch" | string }
	| { type: "local"; loader: null };

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
