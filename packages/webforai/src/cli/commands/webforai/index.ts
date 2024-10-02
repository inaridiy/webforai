import fs from "node:fs/promises";
import path from "node:path";
import { intro, outro, spinner } from "@clack/prompts";
import pc from "picocolors";
import packageInfo from "../../../../package.json";
import { htmlToMarkdown } from "../../../html-to-markdown";
import { inputOutputPath } from "../../helpers/inputOutputPath";
import { inputSourcePath } from "../../helpers/inputSourcePath";
import { selectExtractMode } from "../../helpers/selectExtractMode";
import { selectLoader } from "../../helpers/selectLoader";
import { isUrl } from "../../utils";
import { loadHtml } from "./loadHtml";

const aiModeOptions = { linkAsText: true, tableAsText: true, hideImage: true };
const readabilityModeOptions = { linkAsText: false, tableAsText: false, hideImage: false };

export const webforaiCommand = async (
	initialPath: string,
	options: { output?: string; mode?: string; loader?: string; debug?: boolean },
) => {
	intro(pc.bold(pc.green(`webforai CLI version ${packageInfo.version}`)));

	const sourcePath = initialPath ?? (await inputSourcePath());
	options.debug && console.debug(`sourcePath: ${sourcePath}`);

	const loader = isUrl(sourcePath) ? options.loader ?? (await selectLoader()) : "local";
	options.debug && console.debug(`loader: ${loader}`);

	const outputPath = options.output ?? (await inputOutputPath(sourcePath));
	options.debug && console.debug(`outputPath: ${outputPath}`);

	const mode = options.mode ?? (await selectExtractMode());
	options.debug && console.debug(`mode: ${mode}`);

	let html: string;
	const s = spinner();
	try {
		s.start("Loading content...");
		html = await loadHtml(sourcePath, loader, { debug: options.debug });
		s.stop(pc.green("Content loaded!"));
	} catch (error) {
		s.stop(pc.red("Content loading failed!"));
		console.error(error);
		process.exit(1);
	}
	options.debug && console.debug(`html: ${html}`);

	const markdown = htmlToMarkdown(html, {
		baseUrl: isUrl(sourcePath) ? sourcePath : undefined,
		...(mode === "ai" ? aiModeOptions : readabilityModeOptions),
	});
	options.debug && console.debug(`markdown: ${markdown}`);

	const directory = path.dirname(outputPath);
	const isDirectoryExists = await fs.stat(directory).then((stat) => stat.isDirectory());

	if (!isDirectoryExists) {
		await fs.mkdir(directory, { recursive: true });
	}
	await fs.writeFile(outputPath, markdown);

	outro(pc.green(`${pc.bold("Done!")} Markdown saved to ${outputPath}`));
};
