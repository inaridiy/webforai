/**
 * Cached Trafilatura output, produced by `cli/trafilatura.ts`.
 *
 * Trafilatura is a Python library, so the comparison pipelines read its Markdown from this cache
 * instead of converting in-process. Its recorded time is measured inside Python around the
 * `extract` call: in-process, but in another runtime.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { CACHE_DIR } from "./config.js";
import { htmlKey } from "./firecrawl.js";

export const TRAFILATURA_CACHE = path.join(CACHE_DIR, "trafilatura");

export interface TrafilaturaRecord {
	markdown: string;
	/** Time of `trafilatura.extract` in Python (median of the requested rounds). */
	ms: number;
	ok: boolean;
	error?: string;
	/** Trafilatura version the output came from. */
	version: string;
}

/** The cached record for this exact HTML; throws when the page was never converted. */
export const readTrafilaturaRecord = (html: string): TrafilaturaRecord => {
	const file = path.join(TRAFILATURA_CACHE, `${htmlKey(html)}.json`);
	try {
		return JSON.parse(readFileSync(file, "utf8")) as TrafilaturaRecord;
	} catch {
		throw new Error("No Trafilatura output cached for this page; run `trafilatura` first");
	}
};

/** Trafilatura's Markdown for this HTML; a failed conversion counts as a crash. */
export const trafilaturaMarkdown = (html: string): string => {
	const record = readTrafilaturaRecord(html);
	if (!record.ok) {
		throw new Error(`Trafilatura failed: ${record.error ?? "unknown error"}`);
	}
	return record.markdown;
};
