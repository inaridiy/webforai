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
 * output. Pages already cached with at least as many rounds are skipped. Output is cached in
 * `.cache/trafilatura/<sha256 of the HTML>.json`.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CORPUS } from "../corpus.js";
import { type RenderMode, readCached } from "../fetch.js";
import { htmlKey } from "../firecrawl.js";
import { loadGoldSets } from "../gold/sets.js";
import { TRAFILATURA_CACHE, type TrafilaturaRecord, startTrafilaturaWorker } from "../trafilatura.js";

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

const queue = pages.slice(0, limit);
const total = queue.length;
let done = 0;
let failed = 0;
let version = "";

const worker = async (): Promise<void> => {
	const python = await startTrafilaturaWorker();
	version = python.version;
	try {
		for (;;) {
			const page = queue.shift();
			if (!page) {
				return;
			}
			const html = await page.readHtml();
			const file = path.join(TRAFILATURA_CACHE, `${htmlKey(html)}.json`);
			const cached = JSON.parse(await readFile(file, "utf8").catch(() => "null")) as TrafilaturaRecord | null;
			if (html && (!cached || (cached.rounds ?? 1) < rounds)) {
				const { ms, ...reply } = await python.ask({ html, url: page.url ?? null, rounds });
				const record: TrafilaturaRecord = {
					...reply,
					...(reply.ok && ms !== null ? { ms, rounds } : {}),
					version: python.version,
				};
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
