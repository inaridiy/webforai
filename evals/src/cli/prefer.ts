/**
 * Which Markdown would a reader rather be given? A blinded pairwise comparison of webforai's
 * output with another pipeline's, judged by a model.
 *
 * Usage:
 *   pnpm --filter @webforai/evals prefer -- --sets=wcxb-test --judges=sonnet
 *   pnpm --filter @webforai/evals prefer -- --sets=corpus,wcxb-test --judges=sonnet,codex --opponents=defuddle
 *   pnpm --filter @webforai/evals prefer -- --sets=wcxb-test --judges=sonnet --dry-run
 *   pnpm --filter @webforai/evals prefer -- --sets=corpus,wcxb-test --judges=sonnet,codex --report [--save-results]
 *
 * Token F1 against reference text (`gold:eval`) counts which words were kept and nothing else: a
 * code block run into one line, a table flattened into paragraphs and a link list between two
 * sentences all score the same as clean output. This comparison asks about the Markdown itself.
 *
 * For every page and opponent the two conversions are shown as A and B, once in each order, with
 * no indication of which pipeline wrote which. The judge reads both and answers with a winner, a
 * 0–100 score for each side and the defects it saw. Long outputs are cut identically on both
 * sides (head and tail kept). Judges run through the local CLIs, from an empty temporary
 * directory without tools, MCP servers or user settings: `claude -p` (Sonnet 5.5) and
 * `codex exec` (gpt-6.1-sol, low reasoning effort).
 *
 * Sets: `corpus` — one capture per corpus site, static preferred; the pages webforai is developed
 * on, so its result flatters webforai. `wcxb-test` — the first `--per-type` pages (default 15) of
 * each of WCXB's seven page types in its held-out split.
 *
 * Verdicts are cached in `.cache/prefer/<judge>/` under a hash of the prompt, so a run resumes
 * where it stopped and asks again only where an output changed. `--report` asks nothing.
 * `--save-results` writes the summary to the committed `benchmarks/preference/results.json`.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { htmlToMarkdown } from "webforai";

import { COMPETITORS } from "../competitors.js";
import { CACHE_DIR, EVALS_ROOT } from "../config.js";
import { CORPUS } from "../corpus.js";
import { readCached } from "../fetch.js";
import { loadGoldSets } from "../gold/sets.js";

const arg = (name: string, fallback: string): string =>
	process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const sets = arg("sets", "wcxb-test").split(",");
const judges = arg("judges", "sonnet").split(",");
const opponents = arg("opponents", "readability-turndown,defuddle").split(",");
const perType = Number(arg("per-type", "15"));
const concurrency = Number(arg("concurrency", "6"));
const reportOnly = process.argv.includes("--report");
const dryRun = process.argv.includes("--dry-run");
const saveResults = process.argv.includes("--save-results");

const VERDICTS_DIR = path.join(CACHE_DIR, "prefer");
const RESULTS_PATH = path.join(EVALS_ROOT, "benchmarks", "preference", "results.json");
const TIMEOUT_MS = 300_000;
/** Characters kept from the head and the tail of an output longer than both together. */
const HEAD_CHARS = 12_000;
const TAIL_CHARS = 3_000;

const RUBRIC = `You are evaluating two Markdown conversions (A and B) of the same web page. The Markdown will be given to a reader — a person, or an LLM that must answer questions about the page or summarize it. Decide which conversion serves that reader better.

Judge, in this order of importance:
1. Main content: is the page's primary content complete and faithful? Missing paragraphs, dropped or broken code blocks, tables flattened into unreadable text, garbled formulas or lost list structure are serious defects.
2. Noise: navigation menus, link farms, cookie or consent text, ads, "related articles", footers and other boilerplate that is not the page's content make the reader's job harder.
3. Structure: headings, lists, code fences and tables that make the content easy to navigate.
Do not prefer a conversion merely because it is longer or shorter. Long inputs were cut identically on both sides (a marker shows where); do not penalise the cut itself.`;

const SCHEMA = {
	type: "object",
	properties: {
		winner: { type: "string", enum: ["A", "B", "tie"] },
		scoreA: { type: "number", description: "0-100" },
		scoreB: { type: "number", description: "0-100" },
		aIssues: { type: "array", items: { type: "string" } },
		bIssues: { type: "array", items: { type: "string" } },
		reason: { type: "string", description: "One sentence." },
	},
	required: ["winner", "scoreA", "scoreB", "aIssues", "bIssues", "reason"],
	additionalProperties: false,
};

interface Verdict {
	winner: "A" | "B" | "tie";
	scoreA: number;
	scoreB: number;
	aIssues: string[];
	bIssues: string[];
	reason: string;
}

const workdir = await mkdtemp(path.join(os.tmpdir(), "prefer-"));
const schemaPath = path.join(workdir, "schema.json");
await writeFile(schemaPath, JSON.stringify(SCHEMA));

const run = (
	command: string,
	args: string[],
	input: string,
): Promise<{ code: number; stdout: string; stderr: string }> =>
	new Promise((resolve) => {
		const env = { ...process.env, DISABLE_AUTOUPDATER: "1" };
		const child = spawn(command, args, { cwd: workdir, env, stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ code: -1, stdout, stderr: String(error) });
		});
		child.stdout.on("data", (data) => {
			stdout += data;
		});
		child.stderr.on("data", (data) => {
			stderr += data;
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? -1, stdout, stderr });
		});
		child.stdin.on("error", () => undefined);
		child.stdin.end(input);
	});

const isVerdict = (value: unknown): value is Verdict =>
	typeof value === "object" &&
	value !== null &&
	["A", "B", "tie"].includes((value as Verdict).winner) &&
	typeof (value as Verdict).scoreA === "number" &&
	typeof (value as Verdict).scoreB === "number";

const askClaude = async (user: string): Promise<Verdict | undefined> => {
	const result = await run(
		"claude",
		[
			"-p",
			"--model",
			"claude-sonnet-5-5",
			"--tools",
			"",
			"--strict-mcp-config",
			"--setting-sources",
			"project",
			"--disable-slash-commands",
			"--no-session-persistence",
			"--output-format",
			"json",
			"--json-schema",
			JSON.stringify(SCHEMA),
			"--system-prompt",
			RUBRIC,
		],
		user,
	);
	if (result.code !== 0) {
		return undefined;
	}
	const verdict = (JSON.parse(result.stdout) as { structured_output?: unknown }).structured_output;
	return isVerdict(verdict) ? verdict : undefined;
};

const askCodex = async (user: string): Promise<Verdict | undefined> => {
	const output = path.join(workdir, `${Math.random().toString(36).slice(2)}.json`);
	const result = await run(
		"codex",
		[
			"exec",
			"-m",
			"gpt-6.1-sol",
			"-c",
			"model_reasoning_effort=low",
			"--sandbox",
			"read-only",
			"--ignore-user-config",
			"--ignore-rules",
			"--ephemeral",
			"--skip-git-repo-check",
			"--output-schema",
			schemaPath,
			"-o",
			output,
			"-",
		],
		`${RUBRIC}\n\n---\n\n${user}`,
	);
	if (result.code !== 0) {
		return undefined;
	}
	const verdict: unknown = JSON.parse(await readFile(output, "utf8"));
	return isVerdict(verdict) ? verdict : undefined;
};

const JUDGES: Record<string, { label: string; ask: (user: string) => Promise<Verdict | undefined> }> = {
	sonnet: { label: "Sonnet 5.5", ask: askClaude },
	codex: { label: "gpt-6.1-sol (low)", ask: askCodex },
};

// ------------------------------------------------------------------------ pages

interface Page {
	id: string;
	set: string;
	group: string;
	url: string;
	html: () => Promise<string | undefined>;
}

const loadPages = async (): Promise<Page[]> => {
	const pages: Page[] = [];
	if (sets.includes("corpus")) {
		for (const site of CORPUS) {
			const mode = site.render === "rendered" ? "rendered" : "static";
			pages.push({
				id: `corpus/${site.id}`,
				set: "corpus",
				group: "corpus",
				url: site.url,
				html: () => readCached(site.id, mode, site.url),
			});
		}
	}
	if (sets.includes("wcxb-test")) {
		const taken = new Map<string, number>();
		for (const page of await loadGoldSets(["wcxb-test"])) {
			const count = taken.get(page.dataset) ?? 0;
			if (count < perType) {
				taken.set(page.dataset, count + 1);
				pages.push({
					id: page.id,
					set: "wcxb-test",
					group: page.dataset.split("/").pop() ?? page.dataset,
					url: page.url ?? "https://example.com/",
					html: () => page.readHtml(),
				});
			}
		}
	}
	return pages;
};

const sample = (text: string): string =>
	text.length <= HEAD_CHARS + TAIL_CHARS + 500
		? text
		: `${text.slice(0, HEAD_CHARS)}\n\n[... ${
				text.length - HEAD_CHARS - TAIL_CHARS
			} characters omitted from the middle ...]\n\n${text.slice(-TAIL_CHARS)}`;

const convertWith = async (
	convert: (html: string, url: string) => string | Promise<string>,
	page: Page,
	html: string,
) => {
	try {
		return await convert(html, page.url);
	} catch {
		return "";
	}
};

// ------------------------------------------------------------------------ items

interface Item {
	page: Page;
	opponent: string;
	/** 0: webforai is A; 1: webforai is B. */
	order: 0 | 1;
	judge: string;
	prompt: string;
	file: string;
	chars: { webforai: number; opponent: number };
}

const pages = await loadPages();
const items: Item[] = [];
let missing = 0;
for (const page of pages) {
	const html = await page.html();
	if (!html) {
		missing += 1;
		continue;
	}
	const ours = await convertWith((source, url) => htmlToMarkdown(source, { url }), page, html);
	for (const opponent of opponents) {
		const competitor = COMPETITORS.find((candidate) => candidate.id === opponent);
		if (!competitor) {
			throw new Error(`Unknown pipeline ${opponent}`);
		}
		const theirs = await convertWith(competitor.convert, page, html);
		for (const order of [0, 1] as const) {
			const [a, b] = order === 0 ? [ours, theirs] : [theirs, ours];
			const prompt = `Page URL: ${page.url}\n\n===== CONVERSION A =====\n${sample(
				a,
			)}\n\n===== CONVERSION B =====\n${sample(b)}\n`;
			const hash = createHash("sha256").update(RUBRIC).update(prompt).digest("hex").slice(0, 24);
			for (const judge of judges) {
				items.push({
					page,
					opponent,
					order,
					judge,
					prompt,
					file: path.join(VERDICTS_DIR, judge, `${hash}.json`),
					chars: { webforai: ours.length, opponent: theirs.length },
				});
			}
		}
	}
}
console.info(`${pages.length - missing} pages (${missing} not cached), ${items.length} comparisons`);

const readVerdict = async (item: Item): Promise<Verdict | undefined> => {
	try {
		return JSON.parse(await readFile(item.file, "utf8")) as Verdict;
	} catch {
		return undefined;
	}
};

if (!reportOnly) {
	const pending: Item[] = [];
	for (const item of items) {
		if (!(await readVerdict(item))) {
			pending.push(item);
		}
	}
	console.info(`${pending.length} to ask (${items.length - pending.length} cached)`);
	if (!dryRun) {
		for (const judge of judges) {
			await mkdir(path.join(VERDICTS_DIR, judge), { recursive: true });
		}
		let next = 0;
		let failed = 0;
		const worker = async (): Promise<void> => {
			while (next < pending.length) {
				const item = pending[next++];
				const ask = JUDGES[item.judge]?.ask;
				if (!ask) {
					throw new Error(`Unknown judge ${item.judge}`);
				}
				// A malformed or failed reply is asked once more, then left for the next run.
				const verdict =
					(await ask(item.prompt).catch(() => undefined)) ?? (await ask(item.prompt).catch(() => undefined));
				if (verdict) {
					await writeFile(item.file, JSON.stringify(verdict));
				} else {
					failed += 1;
				}
			}
		};
		await Promise.all(Array.from({ length: concurrency }, worker));
		console.info(`${pending.length - failed} answered, ${failed} failed`);
	}
}

// ------------------------------------------------------------------------ report

interface Row {
	judge: string;
	opponent: string;
	set: string;
	group: string;
	page: string;
	outcome: "win" | "loss" | "tie";
	scoreWebforai: number;
	scoreOpponent: number;
}

const rows: Row[] = [];
for (const item of items) {
	const verdict = await readVerdict(item);
	if (!verdict) {
		continue;
	}
	const oursSlot = item.order === 0 ? "A" : "B";
	rows.push({
		judge: item.judge,
		opponent: item.opponent,
		set: item.page.set,
		group: item.page.group,
		page: item.page.id,
		outcome: verdict.winner === "tie" ? "tie" : verdict.winner === oursSlot ? "win" : "loss",
		scoreWebforai: oursSlot === "A" ? verdict.scoreA : verdict.scoreB,
		scoreOpponent: oursSlot === "A" ? verdict.scoreB : verdict.scoreA,
	});
}

const mean = (values: number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

/** Wins minus losses as a share of verdicts, with a 95% interval from a bootstrap over pages. */
const net = (subset: Row[]): { value: number; low: number; high: number } => {
	const byPage = new Map<string, number[]>();
	for (const row of subset) {
		byPage.set(row.page, [
			...(byPage.get(row.page) ?? []),
			row.outcome === "win" ? 1 : row.outcome === "loss" ? -1 : 0,
		]);
	}
	const perPage = [...byPage.values()].map(mean);
	let seed = 1;
	const random = (): number => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const draws = Array.from({ length: 2000 }, () =>
		mean(perPage.map(() => perPage[Math.floor(random() * perPage.length)])),
	).sort((a, b) => a - b);
	return { value: mean(perPage), low: draws[50] ?? 0, high: draws[1949] ?? 0 };
};

const summarize = (subset: Row[]) => {
	const share = (outcome: Row["outcome"]): number =>
		subset.length ? subset.filter((row) => row.outcome === outcome).length / subset.length : 0;
	const round = (value: number): number => Math.round(value * 1000) / 1000;
	const interval = net(subset);
	return {
		verdicts: subset.length,
		pages: new Set(subset.map((row) => row.page)).size,
		win: round(share("win")),
		loss: round(share("loss")),
		tie: round(share("tie")),
		net: round(interval.value),
		netInterval: [round(interval.low), round(interval.high)],
		scoreWebforai: Math.round(mean(subset.map((row) => row.scoreWebforai)) * 10) / 10,
		scoreOpponent: Math.round(mean(subset.map((row) => row.scoreOpponent)) * 10) / 10,
	};
};

const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;
const results: Record<string, unknown>[] = [];
for (const judge of judges) {
	for (const opponent of opponents) {
		for (const set of sets) {
			const subset = rows.filter((row) => row.judge === judge && row.opponent === opponent && row.set === set);
			if (subset.length === 0) {
				continue;
			}
			const total = summarize(subset);
			const groups = [...new Set(subset.map((row) => row.group))].sort();
			const byGroup = Object.fromEntries(
				groups.map((group) => [group, summarize(subset.filter((row) => row.group === group))]),
			);
			results.push({ judge: JUDGES[judge]?.label ?? judge, opponent, set, ...total, byGroup });
			console.info(
				`\n${JUDGES[judge]?.label ?? judge} · webforai vs ${opponent} · ${set}: ${total.pages} pages, ${
					total.verdicts
				} verdicts`,
			);
			console.info(
				`  preferred ${percent(total.win)}, opponent ${percent(total.loss)}, tie ${percent(total.tie)}; net ${percent(
					total.net,
				)} [${percent(total.netInterval[0] ?? 0)}, ${percent(total.netInterval[1] ?? 0)}]; score ${
					total.scoreWebforai
				} vs ${total.scoreOpponent}`,
			);
			if (groups.length > 1) {
				console.info(
					`  by type: ${groups
						.map((group) => `${group} ${percent(byGroup[group]?.win ?? 0)}/${percent(byGroup[group]?.loss ?? 0)}`)
						.join(", ")}`,
				);
			}
		}
	}
}

if (saveResults) {
	await mkdir(path.dirname(RESULTS_PATH), { recursive: true });
	await writeFile(
		RESULTS_PATH,
		`${JSON.stringify(
			{
				generated: new Date().toISOString().slice(0, 10),
				rubric: RUBRIC,
				sample: { headChars: HEAD_CHARS, tailChars: TAIL_CHARS },
				perType,
				results,
			},
			null,
			"\t",
		)}\n`,
	);
	console.info(`\nwrote ${path.relative(EVALS_ROOT, RESULTS_PATH)}`);
}
