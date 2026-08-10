/**
 * Un-blinds and aggregates the LLM judges' verdicts.
 *
 * The judges only ever saw `A.md` and `B.md`; the A/B-to-version mapping lives in a file they
 * were told not to read. This script joins the two and reports the result.
 *
 * Usage:
 *   pnpm --filter @webforai/evals judge:report
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { REPORTS_DIR } from "../config.js";

interface Verdict {
	pair: string;
	winner: "A" | "B" | "tie";
	confidence?: "high" | "medium" | "low";
	scoreA: number;
	scoreB: number;
	aIssues?: string[];
	bIssues?: string[];
	reasoning?: string;
}

interface MappingEntry {
	url: string;
	category: string;
	aIs: "v2" | "v3";
	v2Chars: number;
	v3Chars: number;
}

const JUDGE_DIR = path.join(REPORTS_DIR, "judge");

const mapping: Record<string, MappingEntry> = JSON.parse(await readFile(path.join(JUDGE_DIR, "mapping.json"), "utf-8"));

let verdictFiles: string[];
try {
	verdictFiles = (await readdir(path.join(JUDGE_DIR, "verdicts"))).filter((name) => name.endsWith(".json"));
} catch {
	console.error("No verdicts found. Run the judges first.");
	process.exit(1);
}

interface Row {
	pair: string;
	category: string;
	winner: "v2" | "v3" | "tie";
	v2Score: number;
	v3Score: number;
	confidence: string;
	v3Issues: string[];
}

const rows: Row[] = [];
const malformed: string[] = [];

for (const file of verdictFiles) {
	const pair = file.replace(/\.json$/, "");
	const entry = mapping[pair];
	if (!entry) {
		malformed.push(`${pair}: not in mapping`);
		continue;
	}

	let verdict: Verdict;
	try {
		verdict = JSON.parse(await readFile(path.join(JUDGE_DIR, "verdicts", file), "utf-8"));
	} catch (error) {
		malformed.push(`${pair}: ${(error as Error).message}`);
		continue;
	}

	// Un-blind: translate the judge's A/B verdict into v2/v3.
	const aIsV3 = entry.aIs === "v3";
	const winner: Row["winner"] = verdict.winner === "tie" ? "tie" : (verdict.winner === "A") === aIsV3 ? "v3" : "v2";

	rows.push({
		pair,
		category: entry.category,
		winner,
		v2Score: aIsV3 ? verdict.scoreB : verdict.scoreA,
		v3Score: aIsV3 ? verdict.scoreA : verdict.scoreB,
		confidence: verdict.confidence ?? "?",
		v3Issues: (aIsV3 ? verdict.aIssues : verdict.bIssues) ?? [],
	});
}

rows.sort((a, b) => a.v3Score - a.v2Score - (b.v3Score - b.v2Score));

const pad = (value: string | number, width: number): string => String(value).padEnd(width);

console.info(
	`${pad("pair", 34)}${pad("category", 16)}${pad("winner", 8)}${pad("v2", 5)}${pad("v3", 5)}${pad("delta", 7)}conf`,
);
console.info("-".repeat(84));

for (const row of rows) {
	const delta = row.v3Score - row.v2Score;
	console.info(
		pad(row.pair, 34) +
			pad(row.category, 16) +
			pad(row.winner, 8) +
			pad(row.v2Score, 5) +
			pad(row.v3Score, 5) +
			pad(delta > 0 ? `+${delta}` : String(delta), 7) +
			row.confidence,
	);
}

const wins = rows.filter((row) => row.winner === "v3").length;
const losses = rows.filter((row) => row.winner === "v2").length;
const ties = rows.filter((row) => row.winner === "tie").length;
const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

console.info("-".repeat(84));
console.info(`judged      : ${rows.length} pairs`);
console.info(`v3 wins     : ${wins}   v2 wins: ${losses}   ties: ${ties}`);
console.info(
	`mean score  : v2 ${mean(rows.map((r) => r.v2Score)).toFixed(1)}   v3 ${mean(rows.map((r) => r.v3Score)).toFixed(1)}`,
);

const regressions = rows.filter((row) => row.winner === "v2");
if (regressions.length > 0) {
	console.info("\nPages where v3 lost — these are the ones worth acting on:");
	for (const row of regressions) {
		console.info(`  ${row.pair} (${row.v2Score} -> ${row.v3Score})`);
		for (const issue of row.v3Issues) {
			console.info(`    - ${issue}`);
		}
	}
}

if (malformed.length > 0) {
	console.info(`\nSkipped ${malformed.length} malformed verdict(s):`);
	for (const problem of malformed) {
		console.info(`  ${problem}`);
	}
}
