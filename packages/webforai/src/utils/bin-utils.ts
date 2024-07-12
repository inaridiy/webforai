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
