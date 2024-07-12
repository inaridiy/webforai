import path from "node:path";
import { log } from "@clack/prompts";

export function logError(error) {
	log.error("An error occurred during processing");
	console.error(error.message);
}

export function isUrl(str) {
	try {
		new URL(str);
		return true;
	} catch {
		return false;
	}
}

export function ensureFileExtension(filePath, extension) {
	if (path.extname(filePath) !== extension) {
		return filePath + extension;
	}
	return filePath;
}
