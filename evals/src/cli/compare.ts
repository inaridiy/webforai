/**
 * Side-by-side comparison of the working tree against the published v2 baseline.
 *
 * Both versions convert every cached capture, so improvements (and regressions) in extraction
 * quality and speed are measured on identical input.
 *
 * Usage:
 *   pnpm --filter @webforai/evals compare
 *   pnpm --filter @webforai/evals compare -- --only=react-learn,shadcn-select
 */

import { htmlToMarkdown as htmlToMarkdownV3 } from "webforai";
import { htmlToMarkdown as htmlToMarkdownV2 } from "webforai-v2";

import { CORPUS, type CorpusSite } from "../corpus.js";
import { type RenderMode, readCached } from "../fetch.js";

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined =>
	args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = flagValue("only")
	?.split(",")
	.map((id) => id.trim());

const modesFor = (site: CorpusSite): RenderMode[] => (site.render === "both" ? ["static", "rendered"] : [site.render]);

interface Measurement {
	bytes: number;
	ms: number;
	headings: number;
	navRatio: number;
	error?: string;
}

const navRatio = (markdown: string): number => {
	const lines = markdown.split("\n").filter((line) => line.trim().length > 0);
	if (lines.length === 0) {
		return 0;
	}
	return lines.filter((line) => /^\s*[-*]?\s*!?\[[^\]]*\]\([^)]*\)\s*$/.test(line)).length / lines.length;
};

const measure = (convert: () => string): Measurement => {
	const started = performance.now();
	try {
		const markdown = convert();
		return {
			bytes: markdown.length,
			ms: performance.now() - started,
			headings: (markdown.match(/^#{1,6} /gm) ?? []).length,
			navRatio: navRatio(markdown),
		};
	} catch (error) {
		return { bytes: 0, ms: performance.now() - started, headings: 0, navRatio: 0, error: (error as Error).message };
	}
};

const pad = (value: string | number, width: number): string => String(value).padEnd(width);

console.info(
	`${pad("site", 30)}${pad("mode", 9)}${pad("v2 KB", 8)}${pad("v3 KB", 8)}${pad("v2 ms", 8)}${pad("v3 ms", 8)}${pad(
		"v2 h",
		6,
	)}${pad("v3 h", 6)}${pad("v2nav%", 8)}${pad("v3nav%", 8)}`,
);
console.info("-".repeat(99));

let v2TotalMs = 0;
let v3TotalMs = 0;
let v2Empty = 0;
let v3Empty = 0;
const v2Nav: number[] = [];
const v3Nav: number[] = [];

for (const site of CORPUS) {
	if (only && !only.includes(site.id)) {
		continue;
	}

	for (const mode of modesFor(site)) {
		const html = await readCached(site.id, mode, site.url);
		if (!html) {
			continue;
		}

		const v2 = measure(() => htmlToMarkdownV2(html, { baseUrl: site.url }) as string);
		const v3 = measure(() => htmlToMarkdownV3(html, { baseUrl: site.url, url: site.url }));

		v2TotalMs += v2.ms;
		v3TotalMs += v3.ms;
		if (v2.bytes < 200) {
			v2Empty += 1;
		}
		if (v3.bytes < 200) {
			v3Empty += 1;
		}
		v2Nav.push(v2.navRatio);
		v3Nav.push(v3.navRatio);

		console.info(
			pad(site.id, 30) +
				pad(mode, 9) +
				pad(Math.round(v2.bytes / 1024), 8) +
				pad(Math.round(v3.bytes / 1024), 8) +
				pad(v2.ms.toFixed(1), 8) +
				pad(v3.ms.toFixed(1), 8) +
				pad(v2.headings, 6) +
				pad(v3.headings, 6) +
				pad((v2.navRatio * 100).toFixed(1), 8) +
				pad((v3.navRatio * 100).toFixed(1), 8),
		);
	}
}

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

console.info("-".repeat(99));
console.info(
	`total time    v2 ${v2TotalMs.toFixed(0)} ms   v3 ${v3TotalMs.toFixed(0)} ms   (${(v2TotalMs / v3TotalMs).toFixed(
		2,
	)}x)`,
);
console.info(`mean nav%     v2 ${(mean(v2Nav) * 100).toFixed(1)}   v3 ${(mean(v3Nav) * 100).toFixed(1)}`);
console.info(`empty outputs v2 ${v2Empty}   v3 ${v3Empty}`);
