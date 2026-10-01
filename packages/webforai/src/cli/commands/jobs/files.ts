import { createHash } from "node:crypto";
import path from "node:path";
import { getNextAvailableFilePath } from "../../utils";

const MAX_SEGMENT_LENGTH = 80;
const MAX_DEPTH = 12;
/** Extensions that name a page rather than its content; dropped so `/a.html` becomes `a.md`. */
const PAGE_EXTENSION = /\.(?:html?|php|aspx?|jsp|md)$/iu;

const shortHash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 8);

const decodeSegment = (segment: string): string => {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
};

/** One path segment → a filename-safe token (no separators, control chars or dot-only names). */
const sanitizeSegment = (segment: string): string => {
	const cleaned = decodeSegment(segment)
		.normalize("NFC")
		.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/gu, "-")
		.replace(/\s+/gu, "-")
		.replace(/-{2,}/gu, "-")
		.replace(/^[-.]+|[-.]+$/gu, "");
	if (cleaned.length <= MAX_SEGMENT_LENGTH) {
		return cleaned;
	}
	return `${cleaned.slice(0, MAX_SEGMENT_LENGTH - 9)}-${shortHash(cleaned)}`;
};

/**
 * Maps a page URL to a relative `.md` path that mirrors the site's structure:
 * `/` → `index.md`, `/docs/` → `docs/index.md`, `/docs/intro.html` → `docs/intro.md`.
 * A query string adds a short stable hash (`search_q-1a2b3c4d.md`) so `?page=2` does not
 * overwrite `?page=1`. `includeHost` prefixes the hostname (batch jobs span origins).
 *
 * The result never escapes the output directory: segments are sanitized one by one, so
 * `..`, encoded slashes and absolute paths cannot survive.
 */
export const pageRelativePath = (pageUrl: string, options: { includeHost?: boolean } = {}): string => {
	const url = new URL(pageUrl);
	const rawSegments = url.pathname.split("/");
	const trailingSlash = url.pathname.endsWith("/");
	const segments = rawSegments.map(sanitizeSegment).filter(Boolean).slice(0, MAX_DEPTH);

	let leaf = trailingSlash || segments.length === 0 ? "index" : segments.pop() ?? "index";
	leaf = leaf.replace(PAGE_EXTENSION, "") || "index";
	if (url.search.length > 1) {
		leaf = `${leaf}_q-${shortHash(url.search)}`;
	}

	const directories = options.includeHost ? [sanitizeSegment(url.host) || "host", ...segments] : segments;
	return path.posix.join(...directories, `${leaf}.md`);
};

export interface PlannedFile {
	url: string;
	/** Path relative to the output directory, POSIX separators. */
	relativePath: string;
}

/**
 * Assigns every URL a distinct relative path. URLs are sorted first so the same set of pages
 * always gets the same names, whatever order the job returned them in; collisions (e.g.
 * `/a` and `/a.html`) take the CLI's usual `_1`, `_2` suffixes. Comparison is
 * case-insensitive because macOS and Windows filesystems are.
 */
export const planOutputFiles = (urls: readonly string[], options: { includeHost?: boolean } = {}): PlannedFile[] => {
	const taken = new Set<string>();
	const sorted = [...new Set(urls)].sort();
	return sorted.map((url) => {
		const candidate = pageRelativePath(url, options);
		const relativePath = getNextAvailableFilePath(candidate, (name) => taken.has(name.toLowerCase()));
		taken.add(relativePath.toLowerCase());
		return { url, relativePath };
	});
};

/** Resolves a planned path inside `outputDir`, refusing anything that would land outside it. */
export const resolveInside = (outputDir: string, relativePath: string): string => {
	const root = path.resolve(outputDir);
	const target = path.resolve(root, ...relativePath.split("/"));
	if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
		throw new Error(`refusing to write outside the output directory: ${relativePath}`);
	}
	return target;
};
