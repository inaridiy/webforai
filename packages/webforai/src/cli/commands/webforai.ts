import { inputOutputPath } from "../helpers/inputOutputPath";
import { inputSourcePath } from "../helpers/inputSourcePath";
import { selectExtractMode } from "../helpers/selectExtractMode";
import { selectLoader } from "../helpers/selectLoader";
import { isUrl, sourcePathToOutputPath } from "../utils";

export const webforaiCommand = async (
	initialPath: string,
	initialOutputPath: string,
	options: { mode?: string; loader: string; debug?: boolean; baseUrl?: string; stdout?: boolean },
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
) => {
	const sourcePath = await inputSourcePath(initialPath);

	const loader = isUrl(sourcePath) && (await selectLoader(options.loader));

	const outputPath = await inputOutputPath(sourcePath, initialOutputPath);

	const mode = await selectExtractMode(options.mode);
};
