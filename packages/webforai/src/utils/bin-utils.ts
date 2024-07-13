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

export function incrementFileName(fileName: string): string {
	const parts = fileName.split(".");
	const name = parts.shift() || "";
	const rest = parts.length > 0 ? `.${parts.join(".")}` : "";

	const numberRegex = /_(\d+)$/;
	const match = name.match(numberRegex);

	if (match) {
		const currentNumber = Number.parseInt(match[1], 10);
		const newNumber = currentNumber + 1;
		return `${name.replace(numberRegex, "")}_${newNumber}${rest}`;
	}
	return `${name}_1${rest}`;
}
