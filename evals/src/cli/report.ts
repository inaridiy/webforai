/**
 * Converts every cached capture and reports accuracy/performance indicators.
 *
 * Usage:
 *   pnpm --filter @webforai/evals report
 *   pnpm --filter @webforai/evals report -- --write   # also dump the Markdown for inspection
 *   pnpm --filter @webforai/evals report -- --only=react-learn
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { REPORTS_DIR } from "../config.js";
import { type ConversionStats, convert } from "../convert.js";
import { CORPUS, type CorpusSite } from "../corpus.js";
import { type RenderMode, readCached } from "../fetch.js";

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined =>
	args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const write = args.includes("--write");
const only = flagValue("only")
	?.split(",")
	.map((id) => id.trim());

const modesFor = (site: CorpusSite): RenderMode[] => (site.render === "both" ? ["static", "rendered"] : [site.render]);

const results: ConversionStats[] = [];

for (const site of CORPUS) {
	if (only && !only.includes(site.id)) {
		continue;
	}

	for (const mode of modesFor(site)) {
		const html = await readCached(site.id, mode, site.url);
		if (!html) {
			continue;
		}
		results.push(convert(site, mode, html));
	}
}

if (write) {
	await mkdir(path.join(REPORTS_DIR, "markdown"), { recursive: true });
	await Promise.all(
		results.map((result) =>
			writeFile(path.join(REPORTS_DIR, "markdown", `${result.id}.${result.mode}.md`), result.markdown),
		),
	);
}

const pad = (value: string | number, width: number): string => String(value).padEnd(width);
const num = (value: number, digits = 1): string => value.toFixed(digits);

console.info(
	`${pad("site", 32)}${pad("mode", 9)}${pad("html", 8)}${pad("md", 8)}${pad("keep%", 7)}${pad("ms", 7)}${pad(
		"h",
		4,
	)}${pad("code", 5)}${pad("tbl", 4)}${pad("img", 5)}${pad("link", 5)}${pad("navL%", 6)}`,
);
console.info("-".repeat(105));

for (const result of results.sort((a, b) => a.id.localeCompare(b.id))) {
	if (result.error) {
		console.info(`${pad(result.id, 32)}${pad(result.mode, 9)}ERROR ${result.error}`);
		continue;
	}
	console.info(
		pad(result.id, 32) +
			pad(result.mode, 9) +
			pad(`${Math.round(result.htmlBytes / 1024)}K`, 8) +
			pad(`${Math.round(result.markdownBytes / 1024)}K`, 8) +
			pad(num(result.retention * 100), 7) +
			pad(num(result.durationMs), 7) +
			pad(result.headings, 4) +
			pad(result.codeBlocks, 5) +
			pad(result.tables, 4) +
			pad(result.images, 5) +
			pad(result.links, 5) +
			pad(num(result.linkOnlyLineRatio * 100), 6),
	);
}

const ok = results.filter((result) => !result.error);
const totalMs = ok.reduce((sum, result) => sum + result.durationMs, 0);
const totalHtml = ok.reduce((sum, result) => sum + result.htmlBytes, 0);

console.info("-".repeat(105));
console.info(`captures       : ${ok.length} (${results.length - ok.length} errors)`);
console.info(`total time     : ${num(totalMs)} ms for ${num(totalHtml / 1024 / 1024, 2)} MB of HTML`);
console.info(`throughput     : ${num(totalHtml / 1024 / totalMs)} KB/ms`);
console.info(`mean nav-link% : ${num((ok.reduce((sum, r) => sum + r.linkOnlyLineRatio, 0) / ok.length) * 100)}`);
console.info(
	`empty outputs  : ${
		ok
			.filter((result) => result.markdownBytes < 200)
			.map((r) => `${r.id}/${r.mode}`)
			.join(", ") || "none"
	}`,
);

if (write) {
	console.info(`\nMarkdown written to ${path.join(REPORTS_DIR, "markdown")}`);
}
