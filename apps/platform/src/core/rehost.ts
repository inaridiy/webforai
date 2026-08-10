import type { ArtifactStore } from "../artifacts/store";
import { PLATFORM_USER_AGENT } from "../engines/workers-fetch";
import { assertPublicHttpUrl } from "./ssrf";

/**
 * Image rehosting: downloads the images a converted document references and rewrites the
 * Markdown to point at our R2 copies, so the result stays readable after the origin rotates
 * or hotlink-protects its assets.
 *
 * This is the one place where partial failure is acceptable: an image that cannot be fetched
 * keeps its original URL and is reported in `failures`, rather than failing the whole page.
 */

export const MAX_REHOSTED_IMAGES = 20;
export const IMAGE_TIMEOUT_MS = 10_000;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RehostDeps {
	artifacts: ArtifactStore;
	/** Injected by unit tests; defaults to the runtime `fetch`. */
	fetch?: FetchLike;
}

export interface RehostedImage {
	original: string;
	rehosted: string;
}

export interface RehostResult {
	markdown: string;
	images: RehostedImage[];
	/** Images left pointing at their origin, with the reason they were not rehosted. */
	failures: { url: string; reason: string }[];
}

const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/** Markdown allows `<...>` around a destination; the angle brackets are not part of the URL. */
const stripAngles = (raw: string): string => (raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw);

const resolveImageUrl = (raw: string, baseUrl: string): string | undefined => {
	const candidate = stripAngles(raw).trim();
	if (!candidate || candidate.startsWith("#") || /^(data|javascript|mailto|tel):/i.test(candidate)) {
		return undefined;
	}
	let absolute: string;
	try {
		absolute = new URL(candidate, baseUrl).href;
	} catch {
		return undefined;
	}
	try {
		return assertPublicHttpUrl(absolute).href;
	} catch {
		// Private/loopback/odd-port targets are never fetched, here or anywhere else.
		return undefined;
	}
};

/**
 * Raw destination token (exactly as written in the document) → absolute URL.
 *
 * Distinct tokens may resolve to the same absolute URL (`/a.png` and `https://host/a.png`);
 * both are kept so both get rewritten, while the download side dedupes by absolute URL. The
 * `MAX_REHOSTED_IMAGES` cap counts distinct absolute URLs.
 */
const collectImageUrls = (markdown: string, baseUrl: string): Map<string, string> => {
	const found = new Map<string, string>();
	const distinct = new Set<string>();

	const add = (raw: string | undefined) => {
		if (raw === undefined || found.has(raw)) {
			return;
		}
		const absolute = resolveImageUrl(raw, baseUrl);
		if (!absolute || (!distinct.has(absolute) && distinct.size >= MAX_REHOSTED_IMAGES)) {
			return;
		}
		distinct.add(absolute);
		found.set(raw, absolute);
	};

	for (const match of markdown.matchAll(MARKDOWN_IMAGE)) {
		add(match[1]);
	}
	for (const match of markdown.matchAll(HTML_IMAGE)) {
		add(match[1] ?? match[2] ?? match[3]);
	}
	return found;
};

/** Replaces the destination inside a matched image, leaving alt text and attributes untouched. */
const swapDestination = (match: string, raw: string, replacement: string): string => {
	const at = match.lastIndexOf(raw);
	return at < 0 ? match : `${match.slice(0, at)}${replacement}${match.slice(at + raw.length)}`;
};

const rewrite = (markdown: string, replacements: Map<string, string>): string => {
	if (replacements.size === 0) {
		return markdown;
	}
	const apply = (match: string, ...groups: (string | undefined)[]): string => {
		const raw = groups.find((group) => group !== undefined);
		const replacement = raw === undefined ? undefined : replacements.get(raw);
		return raw !== undefined && replacement !== undefined ? swapDestination(match, raw, replacement) : match;
	};
	return markdown.replace(MARKDOWN_IMAGE, apply).replace(HTML_IMAGE, apply);
};

const readCappedImage = async (response: Response): Promise<Uint8Array> => {
	const declared = Number(response.headers.get("content-length") ?? Number.NaN);
	if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
		throw new Error(`image exceeds ${MAX_IMAGE_BYTES} bytes`);
	}
	const body = response.body;
	if (!body) {
		return new Uint8Array(0);
	}

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	let chunk = await reader.read();
	while (!chunk.done) {
		size += chunk.value.byteLength;
		if (size > MAX_IMAGE_BYTES) {
			await reader.cancel();
			throw new Error(`image exceeds ${MAX_IMAGE_BYTES} bytes`);
		}
		chunks.push(chunk.value);
		chunk = await reader.read();
	}

	const merged = new Uint8Array(size);
	let offset = 0;
	for (const part of chunks) {
		merged.set(part, offset);
		offset += part.byteLength;
	}
	return merged;
};

const downloadAndStore = async (deps: RehostDeps, url: string): Promise<string> => {
	const request = deps.fetch ?? fetch;
	const response = await request(url, {
		method: "GET",
		redirect: "follow",
		headers: { "user-agent": PLATFORM_USER_AGENT, accept: "image/*" },
		signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`origin responded ${response.status}`);
	}

	// Redirect targets are re-checked: a public URL may still land on a private one.
	assertPublicHttpUrl(response.url || url);

	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().startsWith("image/")) {
		throw new Error(`not an image (content-type "${contentType || "missing"}")`);
	}

	const bytes = await readCappedImage(response);
	return deps.artifacts.putImage(bytes, contentType, url);
};

/** One image either landed in R2 or did not; the union keeps both outcomes explicit. */
type SettledImage = { absolute: string; rehosted: string } | { absolute: string; reason: string };

export const rehostImages = async (deps: RehostDeps, markdown: string, baseUrl: string): Promise<RehostResult> => {
	const tokens = collectImageUrls(markdown, baseUrl);
	if (tokens.size === 0) {
		return { markdown, images: [], failures: [] };
	}

	const settled: SettledImage[] = await Promise.all(
		[...new Set(tokens.values())].map(async (absolute): Promise<SettledImage> => {
			try {
				return { absolute, rehosted: await downloadAndStore(deps, absolute) };
			} catch (error) {
				return { absolute, reason: error instanceof Error ? error.message : String(error) };
			}
		}),
	);

	const stored = new Map<string, string>();
	const images: RehostedImage[] = [];
	const failures: { url: string; reason: string }[] = [];
	for (const result of settled) {
		if ("rehosted" in result) {
			stored.set(result.absolute, result.rehosted);
			images.push({ original: result.absolute, rehosted: result.rehosted });
		} else {
			failures.push({ url: result.absolute, reason: result.reason });
		}
	}

	const replacements = new Map<string, string>();
	for (const [raw, absolute] of tokens) {
		const rehosted = stored.get(absolute);
		if (rehosted !== undefined) {
			replacements.set(raw, rehosted);
		}
	}

	return { markdown: rewrite(markdown, replacements), images, failures };
};
