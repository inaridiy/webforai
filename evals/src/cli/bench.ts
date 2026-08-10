/**
 * Throughput benchmark against the published v2 baseline.
 *
 * Single-pass timings on this workload vary by tens of percent between runs, so every capture is
 * converted repeatedly and the *median* is reported. Both versions are interleaved within each
 * round so that CPU frequency drift affects them equally.
 *
 * Usage:
 *   pnpm --filter @webforai/evals bench
 *   pnpm --filter @webforai/evals bench -- --rounds=7
 */

import { htmlToMarkdown as htmlToMarkdownV3 } from "webforai";
import { htmlToMarkdown as htmlToMarkdownV2 } from "webforai-v2";

import { CORPUS, type CorpusSite } from "../corpus.js";
import { type RenderMode, readCached } from "../fetch.js";

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined =>
	args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const rounds = Number(flagValue("rounds") ?? 5);
const warmup = 1;

const modesFor = (site: CorpusSite): RenderMode[] => (site.render === "both" ? ["static", "rendered"] : [site.render]);

interface Capture {
	site: CorpusSite;
	mode: RenderMode;
	html: string;
}

const captures: Capture[] = [];
for (const site of CORPUS) {
	for (const mode of modesFor(site)) {
		const html = await readCached(site.id, mode, site.url);
		if (html) {
			captures.push({ site, mode, html });
		}
	}
}

if (captures.length === 0) {
	console.error("No cached captures. Run: pnpm --filter @webforai/evals corpus:fetch");
	process.exit(1);
}

const totalBytes = captures.reduce((sum, capture) => sum + capture.html.length, 0);
console.info(`${captures.length} captures, ${(totalBytes / 1024 / 1024).toFixed(2)} MB of HTML`);
console.info(`${warmup} warm-up round + ${rounds} measured rounds\n`);

const median = (values: number[]): number => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

/** Times one full pass over the corpus. Errors are swallowed so one bad page cannot skew a run. */
const timePass = (convert: (html: string, url: string) => string): number => {
	const started = performance.now();
	for (const capture of captures) {
		try {
			convert(capture.html, capture.site.url);
		} catch {
			// A conversion failure is a correctness concern, not a timing one.
		}
	}
	return performance.now() - started;
};

const runV2 = (html: string, url: string): string => htmlToMarkdownV2(html, { baseUrl: url }) as string;
const runV3 = (html: string, url: string): string => htmlToMarkdownV3(html, { baseUrl: url, url });

for (let round = 0; round < warmup; round++) {
	timePass(runV2);
	timePass(runV3);
}

const v2Times: number[] = [];
const v3Times: number[] = [];

for (let round = 0; round < rounds; round++) {
	// Interleaved so that thermal or frequency drift hits both versions alike.
	v2Times.push(timePass(runV2));
	v3Times.push(timePass(runV3));
	console.info(`round ${round + 1}: v2 ${v2Times[round].toFixed(0)} ms   v3 ${v3Times[round].toFixed(0)} ms`);
}

const v2Median = median(v2Times);
const v3Median = median(v3Times);
const megabytes = totalBytes / 1024 / 1024;

console.info(`\n${"".padEnd(46, "-")}`);
console.info(`v2 median   ${v2Median.toFixed(0)} ms   (${(megabytes / (v2Median / 1000)).toFixed(1)} MB/s)`);
console.info(`v3 median   ${v3Median.toFixed(0)} ms   (${(megabytes / (v3Median / 1000)).toFixed(1)} MB/s)`);
console.info(`speed-up    ${(v2Median / v3Median).toFixed(2)}x`);
