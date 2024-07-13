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

	const [firstPart, ...restParts] = fullName.split(".");
	const restName = restParts.length > 0 ? `.${restParts.join(".")}` : "";

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

export function changeFileExtension(filePath: string, newExtension: string): string {
	const parsedPath = filePath.split("/");
	const fileName = parsedPath[parsedPath.length - 1];

	const formattedNewExtension = newExtension.startsWith(".") ? newExtension : `.${newExtension}`;

	if (fileName.startsWith(".")) {
		const parts = fileName.split(".");
		if (parts.length === 2) {
			return parsedPath.slice(0, -1).concat(`${fileName}${formattedNewExtension}`).join("/");
		}
		parts[parts.length - 1] = newExtension.replace(/^\./, "");
		return parsedPath.slice(0, -1).concat(parts.join(".")).join("/");
	}

	const lastDotIndex = fileName.lastIndexOf(".");
	const baseName = lastDotIndex !== -1 ? fileName.slice(0, lastDotIndex) : fileName;
	const newFileName = `${baseName}${formattedNewExtension}`;

	parsedPath[parsedPath.length - 1] = newFileName;
	return parsedPath.join("/");
}

export function urlToFilename(url: string): string {
	try {
		const urlObj = new URL(url);

		const domainParts = urlObj.hostname
			.split(".")
			.reverse()
			.reduce((acc: string[], part: string, index: number) => {
				if (index === 0) {
					return acc;
				}
				if (acc.length >= 2) {
					return acc;
				}
				if (part === "www") {
					return acc;
				}
				// biome-ignore lint/performance/noAccumulatingSpread: <explanation>
				return [part, ...acc];
			}, []);
		const domainString = domainParts.reverse().join("-");

		const pathParts = urlObj.pathname.split("/").filter(Boolean);
		const relevantPathParts = pathParts.slice(-2);
		const pathString = relevantPathParts.map((part) => decodeURIComponent(part)).join("-");

		let filename = [domainString, pathString].filter(Boolean).join("-");

		filename = filename
			.toLowerCase()
			// biome-ignore lint/suspicious/noControlCharactersInRegex: <explanation>
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
			.replace(/[\s.]+/g, "-")
			.replace(/^-+|-+$/g, "");

		return filename || "output";
	} catch {
		return "output";
	}
}
