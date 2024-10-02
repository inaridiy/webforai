import fs from "node:fs";
import path from "node:path";

/**
 * Determines whether a string is a valid URL.
 * @param maybeUrl - The string to check.
 * @returns `true` if the string is a valid URL, otherwise `false`.
 */
export const isUrl = (maybeUrl: string): boolean => {
	try {
		new URL(maybeUrl);
		return true;
	} catch {
		return false;
	}
};

/**
 * Changes the file extension of a given file path.
 * @param filePath - The original file path.
 * @param newExtension - The new extension (with or without the leading dot).
 * @returns The file path with the updated extension.
 */
export function changeFileExtension(filePath: string, newExtension: string): string {
	const parsed = path.parse(filePath);
	const ext = newExtension.startsWith(".") ? newExtension : `.${newExtension}`;
	return path.format({ ...parsed, ext });
}

/**
 * Converts a URL into a safe filename.
 * @param url - The URL to convert.
 * @returns The generated filename, or "output" if conversion fails.
 */
export function urlToFilename(url: string): string {
	try {
		const urlObj = new URL(url);

		// Remove "www." from the hostname and get the last two domain parts
		const hostname = urlObj.hostname.startsWith("www.") ? urlObj.hostname.slice(4) : urlObj.hostname;
		const domainParts = hostname.split(".").slice(-2).join("-");

		// Get the last two parts of the path and decode them
		const pathParts = urlObj.pathname.split("/").filter(Boolean);
		const relevantPathParts = pathParts.slice(-2).map(decodeURIComponent).join("-");

		// Combine domain and path parts
		let filename = [domainParts, relevantPathParts].filter(Boolean).join("-");

		// Clean up the filename
		filename = filename
			.toLowerCase()
			// biome-ignore lint/suspicious/noControlCharactersInRegex:
			.replace(/[<>:"/\\|?*\x00-\x1F]/g, "") // Remove invalid characters
			.replace(/[\s.]+/g, "-") // Replace spaces and dots with hyphens
			.replace(/^-+|-+$/g, ""); // Remove leading and trailing hyphens

		return filename || "output";
	} catch {
		return "output";
	}
}

/**
 * Converts a source path to an output path. If the source is a URL, it generates a filename and changes the extension to .md.
 * If the source is a file path, it simply changes the extension to .md.
 * @param sourcePath - The source path or URL.
 * @returns The corresponding output path.
 */
export const sourcePathToOutputPath = (sourcePath: string): string =>
	isUrl(sourcePath) ? `${urlToFilename(sourcePath)}.md` : changeFileExtension(sourcePath, "md");

/**
 * Retrieves the next available file path by appending a counter if the file already exists.
 * @param filePath - The original file path.
 * @returns A file path that does not currently exist.
 */
export function getNextAvailableFilePath(filePath: string): string {
	const parsed = path.parse(filePath);
	const dir = parsed.dir;
	const ext = parsed.ext;
	const baseName = parsed.name.replace(/_\d+$/, "");
	const match = parsed.name.match(/_(\d+)$/);
	let counter = match ? Number(match[1]) + 1 : 1;

	let newPath = path.join(dir, `${baseName}_${counter}${ext}`);

	while (fs.existsSync(newPath)) {
		counter++;
		newPath = path.join(dir, `${baseName}_${counter}${ext}`);
	}

	return newPath;
}
