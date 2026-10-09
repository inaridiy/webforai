/**
 * Runs Cloudflare Workers AI `toMarkdown` over the same cached HTML webforai is measured on, and
 * caches its Markdown for the `cf-tomarkdown` pipeline in `competitors.ts`.
 *
 * Usage: start the helper Worker (its AI binding calls Cloudflare under the account wrangler is
 * logged in to), then run the harness against it:
 *
 *   pnpm --filter platform exec wrangler dev --config ../../evals/workers/cf-tomarkdown/wrangler.jsonc --port 8799
 *   CF_TOMARKDOWN_URL=http://localhost:8799 pnpm --filter @webforai/evals cf-tomarkdown -- --sets=corpus,wceb
 *
 * Each page's HTML is posted as-is and converted with toMarkdown's defaults (no `cssSelector`, no
 * `hostname`). Output is cached in `.cache/cf-tomarkdown/<sha256 of the HTML>.json`.
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { CF_TOMARKDOWN_CACHE, type CfToMarkdownRecord } from "../cf-tomarkdown.js";
import { CORPUS } from "../corpus.js";
import { type RenderMode, readCached } from "../fetch.js";
import { htmlKey } from "../firecrawl.js";
import { loadWceb } from "../gold/wceb.js";

const arg = (name: string, fallback: string): string =>
	process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const endpoint = process.env.CF_TOMARKDOWN_URL ?? "http://localhost:8799";
const sets = arg("sets", "corpus,wceb").split(",");
const concurrency = Number(arg("concurrency", "6"));
const limit = Number(arg("limit", "1000000"));
const date = new Date().toISOString().slice(0, 10);

const pages: Array<() => Promise<string>> = [];
if (sets.includes("corpus")) {
	for (const site of CORPUS) {
		const modes: RenderMode[] = site.render === "both" ? ["static", "rendered"] : [site.render];
		for (const mode of modes) {
			pages.push(async () => (await readCached(site.id, mode, site.url)) ?? "");
		}
	}
}
if (sets.includes("wceb")) {
	for (const page of await loadWceb()) {
		pages.push(page.readHtml);
	}
}
await mkdir(CF_TOMARKDOWN_CACHE, { recursive: true });

const queue = pages.slice(0, limit);
const total = queue.length;
let done = 0;
let failed = 0;

const convert = async (html: string): Promise<Omit<CfToMarkdownRecord, "date">> => {
	const response = await fetch(endpoint, { method: "POST", body: html, signal: AbortSignal.timeout(120_000) });
	if (!response.ok) {
		return { markdown: "", ok: false, error: `HTTP ${response.status}`, ms: 0 };
	}
	const body = (await response.json()) as { ok: boolean; markdown: string; error?: string; ms: number };
	return { markdown: body.markdown, ok: body.ok, error: body.error, ms: body.ms };
};

const worker = async (): Promise<void> => {
	for (;;) {
		const load = queue.shift();
		if (!load) {
			return;
		}
		const html = await load();
		const file = path.join(CF_TOMARKDOWN_CACHE, `${htmlKey(html)}.json`);
		if (html && !(await stat(file).catch(() => undefined))) {
			let record: CfToMarkdownRecord | undefined;
			// One retry: a transient service error should not count as the converter failing.
			for (let attempt = 0; attempt < 2 && !record?.ok; attempt++) {
				try {
					record = { ...(await convert(html)), date };
				} catch (error) {
					record = { markdown: "", ok: false, error: (error as Error).message, ms: 0, date };
				}
			}
			await writeFile(file, JSON.stringify(record));
			failed += record?.ok ? 0 : 1;
		}
		done += 1;
		if (done % 100 === 0) {
			console.info(`  ${done}/${total} done, ${failed} failed`);
		}
	}
};

console.info(`${total} pages → ${endpoint}`);
await Promise.all(Array.from({ length: concurrency }, worker));
console.info(`done ${done}, failed ${failed}`);
