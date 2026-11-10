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
 *   pnpm --filter @webforai/evals gold:eval -- --compare=current-webforai-comments,current-trafilatura
 *   pnpm --filter @webforai/evals gold:eval -- --lost=current-webforai,current-defuddle --only=webmainbench
 *
 * Sets: `wceb` (default), `wcxb-test`, `wcxb-dev`, `webmainbench`; fetch each once with its
 * `gold:fetch-*` script. `--impl` swaps the webforai module, so another checkout can be measured
 * on identical input. Per-page results go to `.reports/gold/<name>-<pipeline>.jsonl`; the table
 * goes to stdout. `--save-outputs` also writes each page's Markdown to
 * `.reports/gold/<name>-<pipeline>.outputs.jsonl`, which `python/webmainbench_rouge.py` scores.
 *
 * `--compare=<a>,<b>` converts nothing: it reads two saved runs and prints the paired difference
 * a − b in mean F1, over pages and over datasets, each with a 95% interval from a bootstrap
 * stratified by dataset (pages resampled within their dataset; 2,000 draws, fixed seed).
 *
 * `--lost=<run>,<run>,…` converts nothing either: over the pages every listed run scored
 * (`--only=<id prefix>` narrows them to one set), it prints how often each run loses the page —
 * F1 under 0.2, recall under 0.5, recall under 0.8.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
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

const loadRun = async (run: string): Promise<Map<string, PageResult>> => {
	const rows = (await readFile(path.join(REPORTS_DIR, "gold", `${run}.jsonl`), "utf8"))
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as PageResult);
	return new Map(rows.map((row) => [row.id, row]));
};

/** Paired a − b over the pages both runs scored; the dataset is the id's first path segment. */
const comparePaired = async (a: string, b: string): Promise<void> => {
	const [left, right] = [await loadRun(a), await loadRun(b)];
	const byDataset = new Map<string, number[]>();
	for (const [id, row] of left) {
		const other = right.get(id);
		if (other) {
			const dataset = id.split("/")[0];
			byDataset.set(dataset, [...(byDataset.get(dataset) ?? []), row.f1 - other.f1]);
		}
	}
	const datasets = [...byDataset.values()];
	const overPages = (groups: number[][]): number => mean(groups.flat());
	const overDatasets = (groups: number[][]): number => mean(groups.map(mean));
	let seed = 1;
	const random = (): number => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const draws: [number[], number[]] = [[], []];
	for (let i = 0; i < 2000; i++) {
		const resampled = datasets.map((diffs) => diffs.map(() => diffs[Math.floor(random() * diffs.length)]));
		draws[0].push(overPages(resampled));
		draws[1].push(overDatasets(resampled));
	}
	const f = (value: number): string => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(3)}`;
	const interval = (values: number[]): string => {
		const sorted = [...values].sort((x, y) => x - y);
		return `[${f(sorted[50])}, ${f(sorted[1949])}]`;
	};
	const pagesCount = datasets.reduce((n, diffs) => n + diffs.length, 0);
	console.log(`${a} − ${b}: ${pagesCount} paired pages in ${datasets.length} datasets`);
	console.log(`  over pages:    ${f(overPages(datasets))} ${interval(draws[0])}`);
	console.log(`  over datasets: ${f(overDatasets(datasets))} ${interval(draws[1])}`);
};

/**
 * How often each saved run loses the page: over the pages all the runs scored, the share with
 * F1 under 0.2 (the output is not the page's content) and with recall under 0.5 and under 0.8
 * (half, or a fifth, of the reference text is missing). A crash counts as an empty output.
 */
const reportLost = async (runs: string[], only: string | undefined): Promise<void> => {
	const loaded = await Promise.all(runs.map(loadRun));
	const ids = [...(loaded[0]?.keys() ?? [])].filter(
		(id) => (!only || id.startsWith(only)) && loaded.every((run) => run.has(id)),
	);
	const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
	console.log(`${ids.length} pages scored by every run${only ? ` (ids starting with ${only})` : ""}\n`);
	console.log("| run | mean F1 | F1 < 0.2 | recall < 0.5 | recall < 0.8 | crashes |");
	console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
	runs.forEach((run, index) => {
		const rows = ids.map((id) => loaded[index]?.get(id) as PageResult);
		const share = (test: (row: PageResult) => boolean): string => percent(mean(rows.map((row) => Number(test(row)))));
		console.log(
			`| ${run} | ${mean(rows.map((row) => row.f1)).toFixed(3)} | ${share((row) => row.f1 < 0.2)} | ${share(
				(row) => row.recall < 0.5,
			)} | ${share((row) => row.recall < 0.8)} | ${rows.filter((row) => row.crashed).length} |`,
		);
	});
};

const lost = arg("lost");
if (lost) {
	await reportLost(lost.split(","), arg("only"));
	process.exit(0);
}

const compare = arg("compare");
if (compare) {
	const [a, b] = compare.split(",");
	await comparePaired(a, b);
	process.exit(0);
}

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
