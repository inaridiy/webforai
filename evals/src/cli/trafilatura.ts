/**
 * Runs Trafilatura over the same cached HTML webforai is measured on, and caches its Markdown for
 * the `trafilatura` pipeline in `competitors.ts`.
 *
 * Usage (needs `uv`, which installs the pinned Trafilatura from `python/trafilatura_worker.py`):
 *
 *   pnpm --filter @webforai/evals trafilatura -- --sets=corpus --rounds=5 --concurrency=1
 *   pnpm --filter @webforai/evals trafilatura -- --sets=wceb --concurrency=8
 *
 * Each page goes to a Python worker that calls `trafilatura.extract(html, url=url,
 * output_format="markdown")` with Trafilatura's defaults. Time the corpus with `--rounds=5
 * --concurrency=1` (median after a warm-up, like `bench:compare`); larger sets only need the
 * output. Pages already cached are skipped. Output is cached in
 * `.cache/trafilatura/<sha256 of the HTML>.json`.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import { EVALS_ROOT } from "../config.js";
import { CORPUS } from "../corpus.js";
import { type RenderMode, readCached } from "../fetch.js";
import { htmlKey } from "../firecrawl.js";
import { loadGoldSets } from "../gold/sets.js";
import { TRAFILATURA_CACHE, type TrafilaturaRecord } from "../trafilatura.js";

const arg = (name: string, fallback: string): string =>
	process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const sets = arg("sets", "corpus,wceb").split(",");
const concurrency = Number(arg("concurrency", "8"));
const rounds = Number(arg("rounds", "1"));
const limit = Number(arg("limit", "1000000"));

interface Page {
	url?: string;
	readHtml: () => Promise<string>;
}

const pages: Page[] = [];
for (const set of sets) {
	if (set === "corpus") {
		for (const site of CORPUS) {
			const modes: RenderMode[] = site.render === "both" ? ["static", "rendered"] : [site.render];
			for (const mode of modes) {
				pages.push({ url: site.url, readHtml: async () => (await readCached(site.id, mode, site.url)) ?? "" });
			}
		}
	} else {
		pages.push(...(await loadGoldSets([set])));
	}
}
await mkdir(TRAFILATURA_CACHE, { recursive: true });

interface Reply {
	ok: boolean;
	markdown: string;
	error?: string;
	ms: number;
}

/** One long-lived Python process; requests are answered in order, one line each. */
const startWorker = async (): Promise<{
	version: string;
	ask: (page: object) => Promise<Reply>;
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
	const ask = async (page: object): Promise<Reply> => {
		child.stdin?.write(`${JSON.stringify(page)}\n`);
		return JSON.parse(await next()) as Reply;
	};
	return { version, ask, child };
};

const queue = pages.slice(0, limit);
const total = queue.length;
let done = 0;
let failed = 0;
let version = "";

const worker = async (): Promise<void> => {
	const python = await startWorker();
	version = python.version;
	try {
		for (;;) {
			const page = queue.shift();
			if (!page) {
				return;
			}
			const html = await page.readHtml();
			const file = path.join(TRAFILATURA_CACHE, `${htmlKey(html)}.json`);
			if (html && !(await stat(file).catch(() => undefined))) {
				const reply = await python.ask({ html, url: page.url ?? null, rounds });
				const record: TrafilaturaRecord = { ...reply, version: python.version };
				await writeFile(file, JSON.stringify(record));
				failed += record.ok ? 0 : 1;
			}
			done += 1;
			if (done % 100 === 0) {
				console.info(`  ${done}/${total} done, ${failed} failed`);
			}
		}
	} finally {
		python.child.stdin?.end();
	}
};

console.info(`${total} pages → Trafilatura (${concurrency} workers, ${rounds} round(s))`);
await Promise.all(Array.from({ length: concurrency }, worker));
console.info(`done ${done}, failed ${failed} (trafilatura ${version})`);
