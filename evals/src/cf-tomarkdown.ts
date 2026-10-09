/**
 * Cached Cloudflare Workers AI `toMarkdown` output, produced by `cli/cf-tomarkdown.ts`.
 *
 * toMarkdown runs on Cloudflare, so the comparison pipelines read its output from this cache
 * instead of converting in-process; the recorded time is the service's, not a local conversion's.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { CACHE_DIR } from "./config.js";
import { htmlKey } from "./firecrawl.js";

export const CF_TOMARKDOWN_CACHE = path.join(CACHE_DIR, "cf-tomarkdown");

export interface CfToMarkdownRecord {
	markdown: string;
	/** Time of the `env.AI.toMarkdown` call inside the Worker (Cloudflare round trip included). */
	ms: number;
	ok: boolean;
	error?: string;
	/** Date of the run: the service is versioned by Cloudflare, not by us. */
	date: string;
}

/** The cached record for this exact HTML; throws when the page was never converted. */
export const readCfToMarkdownRecord = (html: string): CfToMarkdownRecord => {
	const file = path.join(CF_TOMARKDOWN_CACHE, `${htmlKey(html)}.json`);
	try {
		return JSON.parse(readFileSync(file, "utf8")) as CfToMarkdownRecord;
	} catch {
		throw new Error("No toMarkdown output cached for this page; run `cf-tomarkdown` first");
	}
};

/** toMarkdown's Markdown for this HTML; a failed conversion counts as a crash. */
export const cfToMarkdown = (html: string): string => {
	const record = readCfToMarkdownRecord(html);
	if (!record.ok) {
		throw new Error(`toMarkdown failed: ${record.error ?? "unknown error"}`);
	}
	return record.markdown;
};
