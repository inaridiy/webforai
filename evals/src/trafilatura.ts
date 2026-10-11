/**
 * Cached Trafilatura output, produced by `cli/trafilatura.ts`.
 *
 * Trafilatura is a Python library, so the comparison pipelines read its Markdown from this cache
 * instead of converting in-process. Its recorded time is measured inside Python around the
 * `extract` call: in-process, but in another runtime.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import { CACHE_DIR, EVALS_ROOT } from "./config.js";
import { htmlKey } from "./firecrawl.js";

export const TRAFILATURA_CACHE = path.join(CACHE_DIR, "trafilatura");

export interface TrafilaturaRecord {
	markdown: string;
	/** Time of `trafilatura.extract` in Python (median of `rounds` calls); absent when it failed. */
	ms?: number;
	/** Timed calls behind `ms`; records written before this field count as one. */
	rounds?: number;
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

export interface TrafilaturaReply {
	ok: boolean;
	markdown: string;
	error?: string;
	/** Null when the call failed. */
	ms: number | null;
}

/**
 * One long-lived `python/trafilatura_worker.py` process (started with `uv`); requests are answered
 * in order, one line each. A request is `{ html, url, rounds, options? }`.
 */
export const startTrafilaturaWorker = async (): Promise<{
	version: string;
	ask: (request: object) => Promise<TrafilaturaReply>;
	child: ChildProcess;
}> => {
	const child = spawn("uv", ["run", "--quiet", "--script", path.join(EVALS_ROOT, "python", "trafilatura_worker.py")], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	const lines = createInterface({ input: child.stdout as NodeJS.ReadableStream })[Symbol.asyncIterator]();
	const next = async (): Promise<string> => {
		const { value, done } = await lines.next();
		if (done) {
			throw new Error("Trafilatura worker exited");
		}
		return value as string;
	};
	const { version } = JSON.parse(await next()) as { version: string };
	const ask = async (request: object): Promise<TrafilaturaReply> => {
		child.stdin?.write(`${JSON.stringify(request)}\n`);
		return JSON.parse(await next()) as TrafilaturaReply;
	};
	return { version, ask, child };
};
