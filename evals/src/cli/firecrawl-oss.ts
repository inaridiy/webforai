/**
 * Runs self-hosted Firecrawl OSS over the same cached HTML webforai is measured on, and caches
 * its Markdown for the `firecrawl-oss` pipeline in `competitors.ts`.
 *
 * Usage (Firecrawl started with TEST_SUITE_SELF_HOSTED=true and ALLOW_LOCAL_WEBHOOKS=true so it
 * may fetch from this machine):
 *
 *   FIRECRAWL_URL=http://localhost:3002 pnpm --filter @webforai/evals firecrawl-oss -- \
 *     --sets=corpus,wceb --serve-host=172.17.0.1 --commit=<firecrawl commit> --concurrency=8
 *
 * Each page is served from a local HTTP server and scraped with Firecrawl's defaults for v2
 * (`formats: ["markdown"]`, `onlyMainContent: true`). Firecrawl's code is not part of this
 * repository; only its output is cached, in `.cache/firecrawl/<sha256 of the HTML>.json`.
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { CORPUS } from "../corpus.js";
import { type RenderMode, readCached } from "../fetch.js";
import { FIRECRAWL_CACHE, type FirecrawlRecord, htmlKey } from "../firecrawl.js";
import { loadWceb } from "../gold/wceb.js";

const arg = (name: string, fallback: string): string =>
	process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const firecrawl = process.env.FIRECRAWL_URL ?? "http://localhost:3002";
const sets = arg("sets", "corpus,wceb").split(",");
const serveHost = arg("serve-host", "172.17.0.1");
const port = Number(arg("port", "8765"));
const concurrency = Number(arg("concurrency", "8"));
const commit = arg("commit", "unknown");
const limit = Number(arg("limit", "1000000"));
/**
 * Where Docker cannot reach the host (rootless setups), stage the pages into this directory and
 * serve it from a container on Firecrawl's network; `--serve-base` is then that container's URL.
 */
const stageDir = process.argv.find((value) => value.startsWith("--stage-dir="))?.slice("--stage-dir=".length);
const serveBase = arg("serve-base", `http://${serveHost}:${port}`);

const pages = new Map<string, () => Promise<string>>();
if (sets.includes("corpus")) {
	for (const site of CORPUS) {
		const modes: RenderMode[] = site.render === "both" ? ["static", "rendered"] : [site.render];
		for (const mode of modes) {
			pages.set(`/corpus/${site.id}.${mode}.html`, async () => (await readCached(site.id, mode, site.url)) ?? "");
		}
	}
}
if (sets.includes("wceb")) {
	for (const page of await loadWceb()) {
		pages.set(`/wceb/${page.id}.html`, page.readHtml);
	}
}

if (stageDir) {
	for (const [pathname, load] of pages) {
		const target = path.join(stageDir, pathname);
		if (!(await stat(target).catch(() => undefined))) {
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, await load());
		}
	}
}

const server = createServer(async (request, response) => {
	const load = pages.get(request.url ?? "");
	if (!load) {
		response.writeHead(404).end();
		return;
	}
	response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(await load());
});
if (!stageDir) {
	await new Promise<void>((resolve) => server.listen(port, "0.0.0.0", resolve));
}
await mkdir(FIRECRAWL_CACHE, { recursive: true });

const queue = [...pages.keys()].slice(0, limit);
let done = 0;
let failed = 0;

const scrape = async (url: string): Promise<{ markdown: string; ok: boolean; error?: string }> => {
	const response = await fetch(`${firecrawl}/v2/scrape`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 120_000 }),
		signal: AbortSignal.timeout(180_000),
	});
	const body = (await response.json()) as { success?: boolean; data?: { markdown?: string }; error?: string };
	const markdown = body.data?.markdown ?? "";
	// Firecrawl reports a refused or unreachable target as a successful scrape of an error string.
	if (body.success && /^(Connection Refused|Connection Timeout)$/i.test(markdown.trim())) {
		return { markdown: "", ok: false, error: markdown.trim() };
	}
	return body.success
		? { markdown, ok: true }
		: { markdown: "", ok: false, error: body.error ?? `HTTP ${response.status}` };
};

const worker = async (): Promise<void> => {
	for (;;) {
		const pathname = queue.shift();
		if (!pathname) {
			return;
		}
		const html = await (pages.get(pathname) as () => Promise<string>)();
		const file = path.join(FIRECRAWL_CACHE, `${htmlKey(html)}.json`);
		if (await stat(file).catch(() => undefined)) {
			done += 1;
			continue;
		}
		let record: FirecrawlRecord | undefined;
		for (let attempt = 0; attempt < 2 && !record?.ok; attempt++) {
			const start = performance.now();
			try {
				const result = await scrape(`${serveBase}${pathname}`);
				record = { ...result, ms: performance.now() - start, commit };
			} catch (error) {
				record = { markdown: "", ok: false, error: (error as Error).message, ms: performance.now() - start, commit };
			}
		}
		await writeFile(file, JSON.stringify(record));
		done += 1;
		failed += record?.ok ? 0 : 1;
		if (done % 100 === 0) {
			console.log(`  ${done}/${queue.length + done} done, ${failed} failed`);
		}
	}
};

console.log(`${queue.length} pages → ${firecrawl} (served from ${serveBase})`);
await Promise.all(Array.from({ length: concurrency }, worker));
if (!stageDir) {
	server.close();
}
console.log(`done ${done}, failed ${failed}`);
