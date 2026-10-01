/**
 * Worker-shaped stress test: adversarial and very large pages under a 128 MB heap.
 *
 * Usage:
 *   pnpm --filter @webforai/evals stress                 # every case, both extractors
 *   pnpm --filter @webforai/evals stress -- --case=deep  # one case
 *
 * Cloudflare Workers give an isolate 128 MB and bill CPU time, so what matters is the worst case:
 * no case may crash, exhaust the heap or grow super-linearly. Each case runs in a child process
 * started with `--max-old-space-size=128`, and reports wall time (a CPU-time proxy on an idle
 * machine) and output size.
 *
 * Real pages are taken up to 5 MiB, the platform's fetch ceiling (`MAX_HTML_BYTES`); the largest
 * cached page is also run truncated to exactly that size.
 */

/** The platform refuses larger responses, so a Worker never converts more than this. */
const MAX_HTML_BYTES = 5 * 1024 * 1024;

import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CACHE_DIR } from "../config.js";

const CASES: Record<string, () => string> = {
	flat: () =>
		`<html><body><main>${"<p>Paragraph with a few words, and a comma.</p>".repeat(50_000)}</main></body></html>`,
	deep: () =>
		`<html><body>${"<div>".repeat(2_000)}${"<p>Deep paragraph text.</p>".repeat(20_000)}${"</div>".repeat(
			2_000,
		)}</body></html>`,
	nested: () => `<html><body>${"<div><span>x</span>".repeat(5_000)}${"</div>".repeat(5_000)}</body></html>`,
	table: () => `<html><body><table>${`<tr>${"<td>cell value</td>".repeat(60)}</tr>`.repeat(300)}</table></body></html>`,
	text: () => `<html><body><p>${"word ".repeat(1_000_000)}</p></body></html>`,
	links: () => `<html><body><nav>${'<a href="/x">link</a> '.repeat(30_000)}</nav><p>Body.</p></body></html>`,
	classes: () =>
		`<html><body>${`<div class="${"c ".repeat(2_000)}" id="${"i".repeat(10_000)}"><p>text, here.</p></div>`.repeat(
			200,
		)}</body></html>`,
};

const child = async (): Promise<void> => {
	const [kind, file, extractor] = process.argv.slice(3);
	const html =
		kind === "file"
			? await readFile(file, "utf8")
			: kind === "truncated"
				? new TextDecoder().decode((await readFile(file)).subarray(0, MAX_HTML_BYTES))
				: CASES[file]();
	const src = "../../../packages/webforai/src";
	const { htmlToMarkdown } = await import(`${src}/index.js`);
	// The default pipeline uses kiwame; the heuristic is pinned for comparison.
	let extractors: unknown;
	if (extractor === "takumi") {
		const { createAutoExtractor } = await import(`${src}/extractors/presets/auto.js`);
		const { takumiExtractor } = await import(`${src}/extractors/presets/takumi.js`);
		extractors = createAutoExtractor({ fallback: takumiExtractor });
	}
	const start = performance.now();
	const markdown = htmlToMarkdown(html, extractors ? { extractors } : {});
	const ms = performance.now() - start;
	const heap = process.memoryUsage().heapUsed / 2 ** 20;
	console.log(JSON.stringify({ ms: Math.round(ms), outputChars: markdown.length, heapMiB: Math.round(heap) }));
};

const parent = async (): Promise<void> => {
	const only = process.argv.find((value) => value.startsWith("--case="))?.slice("--case=".length);
	const cases: Array<[string, string]> = Object.keys(CASES).map((name) => ["synthetic", name]);

	// The largest cached real pages, whatever their source.
	const files: Array<{ file: string; size: number }> = [];
	for (const dir of [path.join(CACHE_DIR, "html"), path.join(CACHE_DIR, "gold", "cc", "html")]) {
		for (const name of await readdir(dir).catch(() => [])) {
			const file = path.join(dir, name);
			files.push({ file, size: (await stat(file)).size });
		}
	}
	files.sort((a, b) => b.size - a.size);
	const within = files.filter(({ size }) => size <= MAX_HTML_BYTES);
	cases.push(...within.slice(0, 5).map(({ file }) => ["file", file] as [string, string]));
	if (files[0] && files[0].size > MAX_HTML_BYTES) {
		cases.push(["truncated", files[0].file]);
	}

	const self = fileURLToPath(import.meta.url);
	for (const [kind, name] of cases) {
		if (only && name !== only && path.basename(name) !== only) {
			continue;
		}
		const label = kind === "synthetic" ? name : `${path.basename(name)}${kind === "truncated" ? " (5 MiB)" : ""}`;
		const row: string[] = [label];
		for (const extractor of ["takumi", "kiwame"]) {
			const run = spawnSync(
				process.execPath,
				["--max-old-space-size=128", "--import", "tsx", self, "--child", kind, name, extractor],
				{ encoding: "utf8", timeout: 120_000 },
			);
			const line = run.stdout.trim().split("\n").at(-1) ?? "";
			row.push(
				run.status === 0 ? line : `FAILED (${run.signal ?? run.status}): ${run.stderr.split("\n").slice(-3).join(" ")}`,
			);
		}
		console.log(row.join(" | "));
	}
};

await (process.argv[2] === "--child" ? child() : parent());
