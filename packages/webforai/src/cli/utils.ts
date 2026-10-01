import fs from "node:fs";
import path from "node:path";
import { DEFAULT_BASE_URL } from "../platform";

export const isUrl = (maybeUrl: string) => {
	try {
		new URL(maybeUrl);
		return true;
	} catch {
		return false;
	}
};

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

export const sourcePathToOutputPath = (sourcePath: string) => {
	return isUrl(sourcePath) ? `${urlToFilename(sourcePath)}.md` : changeFileExtension(sourcePath, "md");
};

/**
 * `article.md` → `article_1.md` → `article_2.md` ... until `exists` says the name is free.
 * `exists` defaults to the filesystem; multi-page writers pass an in-memory set so reruns
 * into the same directory overwrite deterministically instead of drifting to new suffixes.
 */
export function getNextAvailableFilePath(
	filePath: string,
	exists: (candidate: string) => boolean = fs.existsSync,
): string {
	const parsedPath = path.parse(filePath);
	const directory = parsedPath.dir;
	const fullName = parsedPath.base;

	const [firstPart, ...restParts] = fullName.split(".");
	const restName = restParts.length > 0 ? `.${restParts.join(".")}` : "";

	const baseName = firstPart.replace(/_\d+$/, "");

	const match = firstPart.match(/_(\d+)$/);
	let counter = match ? Number.parseInt(match[1], 10) + 1 : 1;
	let nextFilePath = filePath;

	while (exists(nextFilePath)) {
		const newName = `${baseName}_${counter}${restName}`;
		nextFilePath = path.join(directory, newName);
		counter++;
	}

	return nextFilePath;
}

/** The dashboard of the configured platform (flag/env override, else the hosted instance). */
export const platformDashboardUrl = (platformUrl?: string): string =>
	`${(platformUrl || DEFAULT_BASE_URL).replace(/\/+$/u, "")}/dashboard`;
