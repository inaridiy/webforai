import fs from "node:fs";
import path from "node:path";
import { log } from "@clack/prompts";

export function logError(error: Error) {
	log.error("An error occurred during processing");
	console.error(error.message);
}

export function isUrl(str: string) {
	try {
		new URL(str);
		return true;
	} catch {
		return false;
	}
}

export function getNextAvailableFilePath(filePath: string): string {
	const parsedPath = path.parse(filePath);
	const directory = parsedPath.dir;
	const fullName = parsedPath.base;

	// ファイル名を最初のドットで分割
	const [firstPart, ...restParts] = fullName.split(".");
	const restName = restParts.length > 0 ? `.${restParts.join(".")}` : "";

	// ベース名から既存の数字を取り除く
	const baseName = firstPart.replace(/_\d+$/, "");

	let counter = 1;
	let nextFilePath = filePath;

	while (fs.existsSync(nextFilePath)) {
		const match = firstPart.match(/_(\d+)$/);
		if (match) {
			counter = Number.parseInt(match[1], 10) + 1;
		}
		const newName = `${baseName}_${counter}${restName}`;
		nextFilePath = path.join(directory, newName);
		counter++;
	}

	return nextFilePath;
}
