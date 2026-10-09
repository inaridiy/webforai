/**
 * Scores extraction pipelines against reference main-content text.
 *
 * Usage:
 *   pnpm --filter @webforai/evals gold:eval                      # webforai on WCEB
 *   pnpm --filter @webforai/evals gold:eval -- --pipelines=webforai,readability-turndown
 *   pnpm --filter @webforai/evals gold:eval -- --impl=/abs/path/to/webforai/src/index.ts --name=main
 *   pnpm --filter @webforai/evals gold:eval -- --limit=200
 *   pnpm --filter @webforai/evals gold:eval -- --sets=wcxb-test --pipelines=webforai,trafilatura
 *   pnpm --filter @webforai/evals gold:eval -- --sets=webmainbench --save-outputs
 *
 * Sets: `wceb` (default), `wcxb-test`, `wcxb-dev`, `webmainbench`; fetch each once with its
 * `gold:fetch-*` script. `--impl` swaps the webforai module, so another checkout can be measured
 * on identical input. Per-page results go to `.reports/gold/<name>-<pipeline>.jsonl`; the table
 * goes to stdout. `--save-outputs` also writes each page's Markdown to
 * `.reports/gold/<name>-<pipeline>.outputs.jsonl`, which `python/webmainbench_rouge.py` scores.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { commentsExtractor, htmlToMarkdown } from "webforai";

import { COMPETITORS } from "../competitors.js";
import { REPORTS_DIR } from "../config.js";
import { loadGoldSets } from "../gold/sets.js";
import { type TokenScore, isMostlyCjk, markdownToPlain, scoreTokens, tokenize } from "../gold/text-metrics.js";

const arg = (name: string): string | undefined =>
	process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

const pipelineIds = (arg("pipelines") ?? "webforai").split(",");
const sets = (arg("sets") ?? "wceb").split(",");
const limit = Number(arg("limit") ?? Number.POSITIVE_INFINITY);
const saveOutputs = process.argv.includes("--save-outputs");
const impl = arg("impl");
const name = arg("name") ?? (impl ? path.basename(path.dirname(path.dirname(path.dirname(impl)))) : "current");

type Convert = (html: string, url: string) => string | Promise<string>;

const thresholdArg = arg("threshold");
const threshold = thresholdArg === undefined ? undefined : Number(thresholdArg);

const resolvePipeline = async (id: string): Promise<Convert> => {
	if (id === "webforai-kiwame") {
		const src = "../../../packages/webforai/src";
		const { htmlToMarkdown } = await import(`${src}/index.js`);
		const { createAutoExtractor } = await import(`${src}/extractors/presets/auto.js`);
		const { createKiwameExtractor } = await import(`${src}/extractors/presets/kiwame.js`);
		const stackModel = process.argv.includes("--no-stack") ? null : undefined;
		const extractors = createAutoExtractor({ fallback: createKiwameExtractor({ threshold, stackModel }) });
		return (html, url) => htmlToMarkdown(html, { baseUrl: url, url, extractors });
	}
	if (id === "webforai-comments") {
		// The `comments` preset: the default content plus reader comments, which Trafilatura keeps by default.
		return (html, url) => htmlToMarkdown(html, { baseUrl: url, url, extractors: commentsExtractor });
	}
	if (id === "webforai-nolinks") {
		// Links as text and no images: what WebMainBench's references (html2text with ignore_links and
		// ignore_images) and Trafilatura's defaults contain, for metrics that count formatting.
		return (html, url) => htmlToMarkdown(html, { baseUrl: url, url, linkAsText: true, hideImage: true });
	}
	if (id === "webforai" && impl) {
		const module = (await import(impl)) as { htmlToMarkdown: (html: string, options: object) => string };
		return (html, url) => module.htmlToMarkdown(html, { baseUrl: url, url });
	}
	const competitor = COMPETITORS.find((candidate) => candidate.id === id);
	if (!competitor) {
		throw new Error(`Unknown pipeline ${id}`);
	}
	return competitor.convert;
};

interface PageResult extends TokenScore {
	id: string;
	group: string;
	ms: number;
	crashed: boolean;
}

const mean = (values: number[]): number =>
	values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const pages = (await loadGoldSets(sets)).slice(0, limit);
await mkdir(path.join(REPORTS_DIR, "gold"), { recursive: true });
console.log(`${pages.length} pages from ${sets.join(", ")}`);

for (const pipelineId of pipelineIds) {
	const convert = await resolvePipeline(pipelineId);
	const results: PageResult[] = [];
	const outputs: string[] = [];

	for (const page of pages) {
		const html = await page.readHtml();
		let markdown = "";
		let crashed = false;
		const start = performance.now();
		try {
			markdown = await convert(html, page.url ?? "https://example.com/");
		} catch {
			crashed = true;
		}
		const ms = performance.now() - start;
		const group = isMostlyCjk(page.gold) ? `${page.dataset} (cjk)` : page.dataset;
		const split = page.tokenize ?? tokenize;
		results.push({
			id: page.id,
			group,
			ms,
			crashed,
			...scoreTokens(split(markdownToPlain(markdown)), split(page.gold)),
		});
		if (saveOutputs) {
			outputs.push(JSON.stringify({ id: page.id, markdown }));
		}
	}
	if (saveOutputs) {
		await writeFile(path.join(REPORTS_DIR, "gold", `${name}-${pipelineId}.outputs.jsonl`), outputs.join("\n"));
	}

	await writeFile(
		path.join(REPORTS_DIR, "gold", `${name}-${pipelineId}.jsonl`),
		results.map((result) => JSON.stringify(result)).join("\n"),
	);

	const groups = [...new Set(results.map((result) => result.group))].sort();
	console.log(`\n## ${pipelineId} (${name})\n`);
	console.log("| group | pages | P | R | F1 | crashes | ms |");
	console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
	const groupF1: number[] = [];
	for (const group of groups) {
		const rows = results.filter((result) => result.group === group);
		const f1 = mean(rows.map((row) => row.f1));
		groupF1.push(f1);
		console.log(
			`| ${group} | ${rows.length} | ${mean(rows.map((r) => r.precision)).toFixed(3)} | ${mean(
				rows.map((r) => r.recall),
			).toFixed(3)} | ${f1.toFixed(3)} | ${rows.filter((r) => r.crashed).length} | ${rows
				.reduce((a, r) => a + r.ms, 0)
				.toFixed(0)} |`,
		);
	}
	console.log(
		`| **all** | ${results.length} | ${mean(results.map((r) => r.precision)).toFixed(3)} | ${mean(
			results.map((r) => r.recall),
		).toFixed(3)} | ${mean(results.map((r) => r.f1)).toFixed(3)} | ${
			results.filter((r) => r.crashed).length
		} | ${results.reduce((a, r) => a + r.ms, 0).toFixed(0)} |`,
	);
	console.log(`\nmacro F1 over groups: ${mean(groupF1).toFixed(4)}`);
}
