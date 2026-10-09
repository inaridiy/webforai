/**
 * Cross-tool extraction-quality benchmark: webforai against common open-source HTML→Markdown
 * pipelines, over the cached corpus. No network access at measure time.
 *
 * Usage:
 *   pnpm --filter @webforai/evals bench:compare
 *   pnpm --filter @webforai/evals bench:compare -- --rounds=7 --no-summary
 *
 * Writes `evals/.reports/<date>-compare/` (full per-capture results, report and every output,
 * gitignored) and `evals/benchmarks/compare-summary.json` (small, committed; feeds the docs page).
 * The metric definitions are frozen in `compare-metrics.ts` and restated in the report.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { fromHtml } from "hast-util-from-html";
import { BUILTIN_ADAPTERS, buildPageSignature, resolveAdapter } from "webforai";

import {
	BOILERPLATE_MARKERS,
	type Check,
	type FidelityCounts,
	type OutputMetrics,
	type SourceFacts,
	analyzeSource,
	hasExpectations,
	measureFidelity,
	measureOutput,
	runChecks,
} from "../compare-metrics.js";
import { COMPETITORS, type Competitor } from "../competitors.js";
import { EVALS_ROOT, REPORTS_DIR } from "../config.js";
import { CORPUS, type CorpusSite } from "../corpus.js";
import { type RenderMode, readCached } from "../fetch.js";
import { readFirecrawlRecord } from "../firecrawl.js";

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined =>
	args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const rounds = Number(flagValue("rounds") ?? 5);
const writeSummary = !args.includes("--no-summary");
const date = new Date().toISOString().slice(0, 10);
const outDir = path.join(REPORTS_DIR, `${date}-compare`);
const summaryPath = path.join(EVALS_ROOT, "benchmarks", "compare-summary.json");

/** Output shorter than this (after trimming) counts as empty — the threshold `report` uses. */
const EMPTY_THRESHOLD = 200;
/** A capture whose link-only line ratio exceeds this is counted as "navigation leaked". */
const NAV_LEAK_THRESHOLD = 0.2;

// ---------------------------------------------------------------------------- inputs

interface Capture {
	site: CorpusSite;
	mode: RenderMode;
	html: string;
	sha256: string;
	source: SourceFacts;
}

const modesFor = (site: CorpusSite): RenderMode[] => (site.render === "both" ? ["static", "rendered"] : [site.render]);

const captures: Capture[] = [];
const missing: string[] = [];
for (const site of CORPUS) {
	for (const mode of modesFor(site)) {
		const html = await readCached(site.id, mode, site.url);
		if (!html) {
			missing.push(`${site.id}/${mode}`);
			continue;
		}
		captures.push({
			site,
			mode,
			html,
			sha256: createHash("sha256").update(html).digest("hex"),
			source: analyzeSource(html),
		});
	}
}

if (captures.length === 0) {
	console.error("No cached captures. Run: pnpm --filter @webforai/evals corpus:fetch");
	process.exit(1);
}

const totalBytes = captures.reduce((sum, capture) => sum + Buffer.byteLength(capture.html), 0);
const corpusFingerprint = createHash("sha256")
	.update(captures.map((capture) => `${capture.site.id}/${capture.mode}:${capture.sha256}`).join("\n"))
	.digest("hex");

console.info(
	`${captures.length} captures (${missing.length} missing), ${(totalBytes / 1024 / 1024).toFixed(2)} MiB; ` +
		`${COMPETITORS.length} pipelines; 1 warm-up + ${rounds} measured rounds\n`,
);

// ---------------------------------------------------------------------------- environment

const git = (...gitArgs: string[]): string => {
	try {
		return execFileSync("git", gitArgs, { cwd: EVALS_ROOT, encoding: "utf-8" }).trim();
	} catch {
		return "unknown";
	}
};

const packageVersion = async (name: string): Promise<string> => {
	const candidates = [
		path.join(EVALS_ROOT, "node_modules", name, "package.json"),
		path.join(EVALS_ROOT, "..", "node_modules", name, "package.json"),
	];
	for (const candidate of candidates) {
		try {
			return JSON.parse(await readFile(candidate, "utf-8")).version as string;
		} catch {
			// Try the next location.
		}
	}
	return "unknown";
};

const environment = {
	date,
	node: process.version,
	cpu: os.cpus()[0]?.model ?? "unknown",
	logicalCpus: os.cpus().length,
	loadAverageAtStart: os.loadavg().map((value) => Number(value.toFixed(2))),
	gitHead: git("rev-parse", "--short", "HEAD"),
	webforaiSourceDirty: git("status", "--porcelain", "--", "../packages/webforai").length > 0,
	versions: {
		webforai: await packageVersion("webforai"),
		"@mozilla/readability": await packageVersion("@mozilla/readability"),
		jsdom: await packageVersion("jsdom"),
		turndown: await packageVersion("turndown"),
		"turndown-plugin-gfm": await packageVersion("turndown-plugin-gfm"),
		"node-html-markdown": await packageVersion("node-html-markdown"),
		defuddle: await packageVersion("defuddle"),
		linkedom: await packageVersion("linkedom"),
		"firecrawl-oss": firecrawlCommit(),
	},
};

// ---------------------------------------------------------------------------- measurement

interface Run {
	markdown: string;
	error?: string;
}

/** The Firecrawl commit recorded with the cached outputs, if any were produced. */
function firecrawlCommit(): string {
	for (const capture of captures) {
		try {
			return readFirecrawlRecord(capture.html).commit;
		} catch {
			// not cached for this capture
		}
	}
	return "not run";
}

const runOnce = async (competitor: Competitor, capture: Capture): Promise<Run> => {
	try {
		return { markdown: await competitor.convert(capture.html, capture.site.url) };
	} catch (thrown) {
		return { markdown: "", error: thrown instanceof Error ? thrown.message : String(thrown) };
	}
};

// Warm-up round. Outputs are deterministic, so this round's output is the one scored.
const outputs = new Map<string, Run>();
const key = (competitor: Competitor, capture: Capture): string =>
	`${competitor.id}\u0000${capture.site.id}\u0000${capture.mode}`;
for (const capture of captures) {
	for (const competitor of COMPETITORS) {
		outputs.set(key(competitor, capture), await runOnce(competitor, capture));
	}
}

const serviceTime = (competitor: Competitor, capture: Capture, fallback: number): number => {
	try {
		return competitor.serviceMs?.(capture.html) ?? fallback;
	} catch {
		return fallback;
	}
};

// Measured rounds. Pipelines are interleaved per capture and the starting pipeline rotates each
// round, so CPU frequency drift and GC pressure are spread across all of them.
const timings = new Map<string, number[]>();
for (let round = 0; round < rounds; round++) {
	const started = performance.now();
	const order = COMPETITORS.map((_, index) => COMPETITORS[(index + round) % COMPETITORS.length]);
	for (const capture of captures) {
		for (const competitor of order) {
			const t0 = performance.now();
			await runOnce(competitor, capture);
			const measured = performance.now() - t0;
			// A service's output is read from a cache; its own recorded time is the comparable figure.
			const elapsed = competitor.serviceMs ? serviceTime(competitor, capture, measured) : measured;
			const samples = timings.get(key(competitor, capture)) ?? [];
			samples.push(elapsed);
			timings.set(key(competitor, capture), samples);
		}
	}
	console.info(`round ${round + 1}/${rounds}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

const median = (values: number[]): number => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

// ---------------------------------------------------------------------------- scoring

interface CaptureResult {
	id: string;
	mode: RenderMode;
	error?: string;
	empty: boolean;
	medianMs: number;
	outputSha256: string;
	metrics: OutputMetrics;
	fidelity: FidelityCounts;
	checks: Check[];
}

const adapterClaims = new Map<string, string | undefined>();
for (const capture of captures) {
	const tree = fromHtml(capture.html, { fragment: true });
	const adapter = resolveAdapter(
		{ hast: tree, url: capture.site.url, signature: buildPageSignature(tree) },
		BUILTIN_ADAPTERS,
	);
	adapterClaims.set(`${capture.site.id}/${capture.mode}`, adapter?.id);
}

const results: Record<string, CaptureResult[]> = {};
for (const competitor of COMPETITORS) {
	results[competitor.id] = captures.map((capture) => {
		const run = outputs.get(key(competitor, capture)) as Run;
		const metrics = measureOutput(run.markdown);
		const checks = run.error
			? runChecks(capture.site, capture.mode, "", measureOutput("")).map((check) => ({ ...check, pass: false }))
			: runChecks(capture.site, capture.mode, run.markdown, metrics);
		if (competitor.id === "webforai") {
			// Adapter claims are a webforai property; evaluate them for the webforai-only total.
			for (const check of checks) {
				if (check.name.startsWith("adapter ")) {
					check.pass = adapterClaims.get(`${capture.site.id}/${capture.mode}`) === check.name.slice(8);
				}
			}
		}
		return {
			id: capture.site.id,
			mode: capture.mode,
			error: run.error,
			empty: run.markdown.trim().length < EMPTY_THRESHOLD,
			medianMs: median(timings.get(key(competitor, capture)) ?? [Number.NaN]),
			outputSha256: createHash("sha256").update(run.markdown).digest("hex"),
			metrics,
			fidelity: measureFidelity(capture.source, run.markdown, metrics),
			checks,
		};
	});
}

const ratio = (numerator: number, denominator: number): number =>
	denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const aggregate = (competitor: Competitor) => {
	const rows = results[competitor.id];
	const crossTool = rows.flatMap((row) => row.checks.filter((check) => !check.excluded));
	const allChecks = rows.flatMap((row) => row.checks);
	const totalMs = sum(rows.map((row) => row.medianMs));
	return {
		id: competitor.id,
		label: competitor.label,
		pipeline: competitor.pipeline,
		extracts: competitor.extracts,
		captures: rows.length,
		crashes: rows.filter((row) => row.error).length,
		emptyOutputs: rows.filter((row) => !row.error && row.empty).length,
		checksPassed: crossTool.filter((check) => check.pass).length,
		checksTotal: crossTool.length,
		capturesAllChecksPassed: rows.filter(
			(row) => row.checks.some((check) => !check.excluded) && row.checks.every((c) => c.excluded || c.pass),
		).length,
		...(competitor.id === "webforai"
			? {
					fullSuitePassed: allChecks.filter((check) => check.pass).length,
					fullSuiteTotal: allChecks.length,
				}
			: {}),
		medianOutputChars: median(rows.map((row) => row.metrics.characters)),
		totalOutputChars: sum(rows.map((row) => row.metrics.characters)),
		meanNavLinkRatio: ratio(sum(rows.map((row) => row.metrics.navLinkRatio)), rows.length),
		capturesNavLeak: rows.filter((row) => row.metrics.navLinkRatio > NAV_LEAK_THRESHOLD).length,
		capturesWithBoilerplateMarker: rows.filter((row) => row.metrics.boilerplateMarkers.length > 0).length,
		boilerplateMarkerHits: sum(rows.map((row) => row.metrics.boilerplateMarkers.length)),
		codeProbes: sum(rows.map((row) => row.fidelity.codeProbes)),
		codeProbesFenced: sum(rows.map((row) => row.fidelity.codeProbesFenced)),
		codeFenceRecall: ratio(
			sum(rows.map((row) => row.fidelity.codeProbesFenced)),
			sum(rows.map((row) => row.fidelity.codeProbes)),
		),
		dataTables: sum(rows.map((row) => row.fidelity.dataTables)),
		tablesPreserved: sum(rows.map((row) => row.fidelity.tablesPreserved)),
		tableRecall: ratio(
			sum(rows.map((row) => row.fidelity.tablesPreserved)),
			sum(rows.map((row) => row.fidelity.dataTables)),
		),
		capturesWithRawHtmlTable: rows.filter((row) => row.metrics.rawHtmlTables > 0).length,
		totalMedianMs: Number(totalMs.toFixed(1)),
		medianCaptureMs: Number(median(rows.map((row) => row.medianMs)).toFixed(2)),
		throughputMiBps: Number((totalBytes / 1024 / 1024 / (totalMs / 1000)).toFixed(2)),
		failedChecks: rows.flatMap((row) =>
			row.checks
				.filter((check) => !(check.excluded || check.pass))
				.map((check) => `${row.id}/${row.mode}: ${check.name}`),
		),
	};
};

const aggregates = COMPETITORS.map(aggregate);
const excludedChecks = results.webforai.flatMap((row) =>
	row.checks.filter((check) => check.excluded).map((check) => ({ capture: `${row.id}/${row.mode}`, ...check })),
);

const methodology = {
	corpus: `${
		captures.length
	} cached captures from evals/src/corpus.ts (static and rendered forms of one site are both included and are correlated), ${(
		totalBytes /
		1024 /
		1024
	).toFixed(2)} MiB of UTF-8 HTML; missing: ${missing.join(", ") || "none"}`,
	assertions:
		"Existing evals/src/assertions.ts expectations, unchanged, applied to every pipeline's output; headings, code blocks and tables are counted from a CommonMark + GFM parse (so setext headings and indented code count like ATX headings and fences), plus UTF-16 length, link-only-line ratio and presence/absence anchors. Excluded from the cross-tool score: adapter-claim checks and anchors that match webforai's own adapter output format (listed in excludedChecks). A crash fails every check of that capture.",
	emptyOutput: `trimmed output shorter than ${EMPTY_THRESHOLD} characters (a crash is counted separately)`,
	navLeak: `link-only-line ratio above ${NAV_LEAK_THRESHOLD}`,
	boilerplateMarkers: `case-insensitive substrings: ${BOILERPLATE_MARKERS.join(", ")}`,
	codeFenceRecall:
		"for every <pre> in the source with a line of 12–200 characters (block elements inside <pre> count as line breaks), its longest such line (whitespace-collapsed) must appear as a line inside a code block of the output (fenced or indented, from a CommonMark parse); pooled over the corpus. Measures recall only — it cannot penalize keeping code from page chrome.",
	tableRecall:
		"source data tables = <table> with a <th> and no nested table; preserved = min(GFM tables in output, source data tables) per capture; pooled. Recall only.",
	timing: `1 warm-up round, then ${rounds} measured rounds; each conversion timed individually with pipelines interleaved per capture and the starting pipeline rotated each round; per-capture median, summed over the corpus. Includes HTML parsing (jsdom for Readability, linkedom for Defuddle). Single process, not CPU-pinned. Firecrawl OSS runs as a service: its figure is the per-page wall time of its scrape request recorded by \`firecrawl-oss\` (queueing, fetching the locally served page, extraction and conversion; 8 concurrent requests), not an in-process conversion, so it is not directly comparable.`,
};

// ---------------------------------------------------------------------------- outputs

await mkdir(outDir, { recursive: true });
for (const competitor of COMPETITORS) {
	const dir = path.join(outDir, "markdown", competitor.id);
	await mkdir(dir, { recursive: true });
	await Promise.all(
		captures.map((capture) =>
			writeFile(
				path.join(dir, `${capture.site.id}.${capture.mode}.md`),
				(outputs.get(key(competitor, capture)) as Run).markdown,
			),
		),
	);
}

const captureManifest = captures.map((capture) => ({
	id: capture.site.id,
	mode: capture.mode,
	url: capture.site.url,
	bytes: Buffer.byteLength(capture.html),
	sha256: capture.sha256,
	hasAssertions: hasExpectations(capture.site, capture.mode),
	sourceCodeProbes: capture.source.codeProbes.length,
	sourceDataTables: capture.source.dataTables,
}));

await writeFile(
	path.join(outDir, "results.json"),
	`${JSON.stringify(
		{ environment, methodology, corpusFingerprint, captures: captureManifest, aggregates, excludedChecks, results },
		null,
		2,
	)}\n`,
);

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const table = (headers: string[], rows: (string | number)[][]): string =>
	[
		`| ${headers.join(" | ")} |`,
		`| ${headers.map((_, index) => (index === 0 ? "---" : "---:")).join(" | ")} |`,
		...rows.map((row) => `| ${row.join(" | ")} |`),
	].join("\n");

const report = `# Cross-tool extraction benchmark — ${date}

Generated by \`pnpm --filter @webforai/evals bench:compare\`. Commit ${environment.gitHead}${
	environment.webforaiSourceDirty ? " (packages/webforai has uncommitted changes)" : ""
}; Node ${environment.node}; ${environment.cpu} (${
	environment.logicalCpus
} logical CPUs); load at start ${environment.loadAverageAtStart.join(", ")}.

Corpus fingerprint \`${corpusFingerprint.slice(0, 16)}\` — ${methodology.corpus}.

## Pipelines

${COMPETITORS.map((competitor) => `- **${competitor.label}** — ${competitor.pipeline}`).join("\n")}

Versions: ${Object.entries(environment.versions)
	.map(([name, version]) => `${name} ${version}`)
	.join(", ")}.

## Results

${table(
	[
		"Pipeline",
		"Checks passed",
		"Crashes",
		"Empty",
		"Nav leak",
		"Boilerplate",
		"Code fenced",
		"Tables",
		"Median chars",
		"Corpus ms",
	],
	aggregates.map((entry) => [
		entry.label,
		`${entry.checksPassed}/${entry.checksTotal}`,
		entry.crashes,
		entry.emptyOutputs,
		entry.capturesNavLeak,
		entry.capturesWithBoilerplateMarker,
		`${pct(entry.codeFenceRecall)} (${entry.codeProbesFenced}/${entry.codeProbes})`,
		`${pct(entry.tableRecall)} (${entry.tablesPreserved}/${entry.dataTables})`,
		entry.medianOutputChars,
		entry.totalMedianMs,
	]),
)}

webforai full suite including the excluded checks: ${aggregates[0].fullSuitePassed}/${aggregates[0].fullSuiteTotal}.

## Metric definitions (frozen before measuring)

${Object.entries(methodology)
	.map(([name, text]) => `- **${name}**: ${text}`)
	.join("\n")}

## Excluded checks

${excludedChecks.map((check) => `- ${check.capture} \`${check.name}\` — ${check.excluded}`).join("\n")}

## Failed checks

${aggregates
	.map(
		(entry) =>
			`### ${entry.label}\n\n${entry.failedChecks.map((line) => `- ${line}`).join("\n") || "- none"}${
				entry.crashes > 0
					? `\n\nCrashes: ${results[entry.id]
							.filter((row) => row.error)
							.map((row) => `${row.id}/${row.mode} (${row.error})`)
							.join("; ")}`
					: ""
			}`,
	)
	.join("\n\n")}

## Per-capture output characters

${table(
	["Capture", ...COMPETITORS.map((competitor) => competitor.label)],
	captures.map((capture, index) => [
		`${capture.site.id}/${capture.mode}`,
		...COMPETITORS.map((competitor) => {
			const row = results[competitor.id][index];
			return row.error ? "crash" : row.metrics.characters;
		}),
	]),
)}
`;
await writeFile(path.join(outDir, "report.md"), report);

if (writeSummary) {
	await mkdir(path.dirname(summaryPath), { recursive: true });
	const summary = {
		$comment:
			"Generated by `pnpm --filter @webforai/evals bench:compare`. Aggregates only — no page content. Full per-capture results stay in the gitignored evals/.reports/.",
		environment,
		corpus: {
			captures: captures.length,
			missing,
			mebibytes: Number((totalBytes / 1024 / 1024).toFixed(2)),
			fingerprint: corpusFingerprint,
		},
		methodology,
		excludedChecks: excludedChecks.map((check) => `${check.capture}: ${check.name}`),
		results: aggregates,
	};
	await writeFile(summaryPath, `${JSON.stringify(summary, null, "\t")}\n`);
	// The summary is committed, so leave it in the repository's formatter style (the pre-commit
	// hook runs biome over it).
	try {
		execFileSync(path.join(EVALS_ROOT, "..", "node_modules", ".bin", "biome"), ["format", "--write", summaryPath], {
			stdio: "ignore",
		});
	} catch {
		console.warn("Could not run biome on the summary; run `pnpm format:fix` before committing it.");
	}
}

console.info(`\n${report.split("## Metric definitions")[0]}`);
console.info(`Report: ${path.relative(process.cwd(), outDir)}`);
if (writeSummary) {
	console.info(`Summary: ${path.relative(process.cwd(), summaryPath)}`);
}
