/**
 * Cached Firecrawl OSS output, produced by `cli/firecrawl-oss.ts`.
 *
 * Firecrawl runs as a service, so the comparison pipelines read its output from this cache instead
 * of converting in-process; the recorded time is the service's, not a local conversion's.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { CACHE_DIR } from "./config.js";

export const FIRECRAWL_CACHE = path.join(CACHE_DIR, "firecrawl");

export interface FirecrawlRecord {
	markdown: string;
	/** Wall time of the scrape request, including Firecrawl fetching the page from this machine. */
	ms: number;
	ok: boolean;
	error?: string;
	/** Firecrawl commit the output came from. */
	commit: string;
}

export const htmlKey = (html: string): string => createHash("sha256").update(html).digest("hex");

/** The cached record for this exact HTML; throws when the page was never run through Firecrawl. */
export const readFirecrawlRecord = (html: string): FirecrawlRecord => {
	const file = path.join(FIRECRAWL_CACHE, `${htmlKey(html)}.json`);
	try {
		return JSON.parse(readFileSync(file, "utf8")) as FirecrawlRecord;
	} catch {
		throw new Error("No Firecrawl output cached for this page; run `firecrawl-oss` first");
	}
};

/** Firecrawl's Markdown for this HTML; a failed scrape converts to nothing, like a crash. */
export const firecrawlMarkdown = (html: string): string => {
	const record = readFirecrawlRecord(html);
	if (!record.ok) {
		throw new Error(`Firecrawl failed: ${record.error ?? "unknown error"}`);
	}
	return record.markdown;
};
