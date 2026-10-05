/**
 * YouTube adapter.
 *
 * A watch page has essentially no readable DOM: the title, channel and description live in an
 * embedded `ytInitialPlayerResponse` JSON blob, and everything visible is player chrome and
 * recommendation rails. Generic extraction produces an empty document, so this adapter reads the
 * blob directly.
 *
 * Captions are intentionally not fetched. They live behind separate, short-lived, signed URLs,
 * and issuing network requests from a synchronous HTML-to-Markdown conversion would be a
 * surprising side effect. `youtubeCaptionTracks` exposes the track list so callers can fetch
 * them deliberately.
 */

import type { Element, ElementContent, Nodes as Hast, RootContent } from "hast";

import { collectElements, isElement } from "../../utils/hast-fast";
import type { SiteAdapter } from "../types";

interface VideoDetails {
	title?: string;
	author?: string;
	shortDescription?: string;
	lengthSeconds?: string;
	viewCount?: string;
	keywords?: string[];
	channelId?: string;
}

export interface CaptionTrack {
	languageCode: string;
	name?: string;
	url: string;
	isAutomatic: boolean;
}

/**
 * Extracts a top-level JSON object assigned to `name` from a script body.
 *
 * A regex cannot do this correctly — descriptions routinely contain braces and escaped quotes —
 * so the object is located by brace matching while tracking string and escape state.
 */
/**
 * Finds the index just past the closing brace of the JSON object starting at `start`.
 *
 * Tracks string and escape state, because descriptions routinely contain braces and escaped
 * quotes that a brace counter alone would miscount. Returns -1 when the object never closes.
 */
const findObjectEnd = (source: string, start: number): number => {
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let index = start; index < source.length; index++) {
		const character = source[index];

		if (escaped) {
			escaped = false;
		} else if (character === "\\") {
			escaped = true;
		} else if (character === '"') {
			inString = !inString;
		} else if (!inString) {
			if (character === "{") {
				depth += 1;
			} else if (character === "}" && --depth === 0) {
				return index + 1;
			}
		}
	}

	return -1;
};

export const extractAssignedJson = (source: string, name: string): unknown => {
	const markerIndex = source.indexOf(`${name} =`);
	if (markerIndex === -1) {
		return undefined;
	}

	const start = source.indexOf("{", markerIndex);
	if (start === -1) {
		return undefined;
	}

	const end = findObjectEnd(source, start);
	if (end === -1) {
		return undefined;
	}

	try {
		return JSON.parse(source.slice(start, end));
	} catch {
		return undefined;
	}
};

const scriptText = (root: Hast): string[] =>
	collectElements(root, (element) => element.tagName === "script").map((script) =>
		script.children.map((child) => (child.type === "text" ? child.value : "")).join(""),
	);

/** The script variable holding a watch page's title, description and caption tracks. */
export const PLAYER_RESPONSE_VARIABLE = "ytInitialPlayerResponse";

const findPlayerResponse = (root: Hast): Record<string, unknown> | undefined => {
	for (const source of scriptText(root)) {
		if (!source.includes(PLAYER_RESPONSE_VARIABLE)) {
			continue;
		}
		const parsed = extractAssignedJson(source, PLAYER_RESPONSE_VARIABLE);
		if (parsed && typeof parsed === "object") {
			return parsed as Record<string, unknown>;
		}
	}
	return undefined;
};

/**
 * Lists the caption tracks advertised by a YouTube watch page.
 *
 * Returned URLs are signed and expire, so fetch them promptly or re-read the page.
 */
export const youtubeCaptionTracks = (root: Hast): CaptionTrack[] => {
	const player = findPlayerResponse(root);
	const renderer = (player?.captions as Record<string, unknown> | undefined)?.playerCaptionsTracklistRenderer as
		| Record<string, unknown>
		| undefined;
	const tracks = renderer?.captionTracks;

	if (!Array.isArray(tracks)) {
		return [];
	}

	return tracks.flatMap((track: Record<string, unknown>) => {
		const url = typeof track.baseUrl === "string" ? track.baseUrl : undefined;
		const languageCode = typeof track.languageCode === "string" ? track.languageCode : undefined;
		if (!(url && languageCode)) {
			return [];
		}
		const name = (track.name as Record<string, unknown> | undefined)?.simpleText;
		return [
			{
				url,
				languageCode,
				name: typeof name === "string" ? name : undefined,
				isAutomatic: track.kind === "asr",
			},
		];
	});
};

const text = (value: string): ElementContent => ({ type: "text", value });

const element = (tagName: string, children: ElementContent[]): Element => ({
	type: "element",
	tagName,
	properties: {},
	children,
});

const heading = (depth: number, value: string): Element => element(`h${depth}`, [text(value)]);

const paragraph = (value: string): Element => element("p", [text(value)]);

/** Renders a description, preserving its blank-line paragraph structure. */
const descriptionNodes = (description: string): Element[] =>
	description
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter((block) => block.length > 0)
		.map((block) =>
			element(
				"p",
				block.split("\n").flatMap((line, index) => (index === 0 ? [text(line)] : [element("br", []), text(line)])),
			),
		);

const formatDuration = (seconds: number): string => {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainder = seconds % 60;
	const pad = (value: number): string => String(value).padStart(2, "0");
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(remainder)}` : `${minutes}:${pad(remainder)}`;
};

const metadataList = (details: VideoDetails): Element | undefined => {
	const items: Element[] = [];

	if (details.author) {
		items.push(element("li", [text(`Channel: ${details.author}`)]));
	}
	const seconds = Number(details.lengthSeconds);
	if (Number.isFinite(seconds) && seconds > 0) {
		items.push(element("li", [text(`Duration: ${formatDuration(seconds)}`)]));
	}
	const views = Number(details.viewCount);
	if (Number.isFinite(views) && views > 0) {
		items.push(element("li", [text(`Views: ${views.toLocaleString("en-US")}`)]));
	}

	return items.length > 0 ? element("ul", items) : undefined;
};

export const youtubeAdapter: SiteAdapter = {
	id: "youtube",

	matches: ({ url }) => {
		if (!url) {
			return false;
		}
		try {
			return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(new URL(url).hostname);
		} catch {
			return false;
		}
	},

	// Scanning every script body for the JSON blob would cost a full traversal on every page, so
	// the fallback keys off markers the signature already collected.
	matchesFingerprint: ({ signature }) =>
		Boolean(signature?.ids.has("movie_player") || signature?.classes.has("ytd-app")),

	extract: ({ hast }) => {
		const player = findPlayerResponse(hast);
		const details = player?.videoDetails as VideoDetails | undefined;

		if (!details?.title) {
			return undefined;
		}

		const children: RootContent[] = [heading(1, details.title)];

		const metadata = metadataList(details);
		if (metadata) {
			children.push(metadata);
		}

		const description = details.shortDescription?.trim();
		if (description) {
			children.push(heading(2, "Description"));
			children.push(...descriptionNodes(description));
		}

		const tracks = youtubeCaptionTracks(hast);
		if (tracks.length > 0) {
			const languages = [...new Set(tracks.map((track) => track.languageCode))].sort();
			children.push(paragraph(`Captions available: ${languages.join(", ")}`));
		}

		return { type: "root", children } satisfies Hast;
	},
};

/** Re-exported so callers can narrow a tree before handing it to the adapter. */
export const isYoutubeElement = isElement;
