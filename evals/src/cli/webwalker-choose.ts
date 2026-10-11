/**
 * Next-link choice on WebWalkerQA: given the task's question and one pipeline's output for the
 * page, does a model pick a link that leads to the answer?
 *
 * Usage (after `webwalker:fetch` and `webwalker:links`):
 *   pnpm --filter @webforai/evals webwalker:choose -- --models=haiku --reps=3 --concurrency=12 [--set=related-hops]
 *   pnpm --filter @webforai/evals webwalker:choose -- --models=haiku,sonnet,codex --report
 *
 * Models run through the local CLIs, so a subscription can pay for them: `claude -p` (Haiku 5.5,
 * Sonnet 5.5; no tools, a fixed system prompt, structured output) and `codex exec` (gpt-6.1-sol,
 * low reasoning effort). The API serves the same models. Each answer is cached in
 * `.cache/webwalker/choices/<model>-r<rep>/<pipeline>/`, so a run resumes where it stopped.
 *
 * Every hop of every resolved golden path is one item: the page's output from `webwalker:links`
 * (`.reports/webwalker/<pipeline>.outputs.jsonl`) and the task's question. The model answers with
 * one URL copied from the page. It is correct when it is a next link of any of the task's golden
 * paths on that page, or one of the task's source pages; a URL that is not a link in the output
 * counts as wrong (the model may not navigate from memory). An output without links is wrong
 * without asking.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
	type Hop,
	LINK_REPORTS_DIR,
	LINK_SET,
	WEBWALKER_DIR,
	loadHops,
	loadNavTasks,
	markdownLinks,
	normalizeUrl,
	readPage,
} from "../webwalker.js";

const arg = (name: string, fallback: string): string =>
	process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const models = arg("models", "haiku").split(",");
const reps = Number(arg("reps", "1"));
const concurrency = Number(arg("concurrency", "12"));
const limit = Number(arg("limit", "100000"));
const reportOnly = process.argv.includes("--report");

const OUT_DIR = LINK_REPORTS_DIR;
const CHOICES_DIR = path.join(WEBWALKER_DIR, "choices");
const TIMEOUT_MS = 180_000;
/** Outputs longer than this are cut (full-page conversions of a few portal pages). */
const MAX_CHARS = 300_000;

export const PIPELINES = [
	["webforai", "webforai (readability)"],
	["webforai-agent", "webforai (agent)"],
	["webforai-agent-flat", "webforai (agent, no role headings)"],
	["webforai-agent-compact", "webforai (agent, same-site links as paths)"],
	["webforai-all-links", "webforai + all links"],
	["readability-turndown", "Readability + Turndown"],
	["defuddle", "Defuddle"],
	["trafilatura-links", "Trafilatura (include_links)"],
	["turndown", "Turndown (full page)"],
	["node-html-markdown", "node-html-markdown (full page)"],
] as const;

const MODELS: Record<string, { label: string; ask: (system: string, user: string) => Promise<Answer> }> = {
	haiku: { label: "Haiku 5.5", ask: (system, user) => askClaude("claude-haiku-5-5", system, user) },
	sonnet: { label: "Sonnet 5.5", ask: (system, user) => askClaude("claude-sonnet-5-5", system, user) },
	codex: { label: "gpt-6.1-sol (low)", ask: (system, user) => askCodex(system, user) },
};

const SYSTEM = `You are a web-browsing agent. You answer questions about a website by opening one page after another. You are given the question and the page you are on, converted to Markdown.

Choose the single link on this page that you would open next to find the answer. Copy its URL exactly as it appears in the page. Do not invent URLs: only links present in the page can be opened.`;

const SCHEMA = {
	type: "object",
	properties: { url: { type: "string", description: "The URL of the link to open next, copied from the page." } },
	required: ["url"],
	additionalProperties: false,
};

interface Answer {
	url?: string;
	error?: string;
	/** What the call would have cost on the API, as the CLI reports it. */
	costUsd?: number;
	inputTokens?: number;
}

const workdir = await mkdtemp(path.join(os.tmpdir(), "webwalker-choose-"));
const schemaPath = path.join(workdir, "schema.json");
await writeFile(schemaPath, JSON.stringify(SCHEMA));

const run = (
	command: string,
	args: string[],
	input: string,
): Promise<{ code: number; stdout: string; stderr: string }> =>
	new Promise((resolve) => {
		const child = spawn(command, args, { cwd: workdir, stdio: ["pipe", "pipe", "pipe"] });
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

const askClaude = async (model: string, system: string, user: string): Promise<Answer> => {
	const result = await run(
		"claude",
		[
			"-p",
			"--model",
			model,
			"--tools",
			"",
			"--no-session-persistence",
			"--output-format",
			"json",
			"--json-schema",
			JSON.stringify(SCHEMA),
			"--system-prompt",
			system,
		],
		user,
	);
	if (result.code !== 0) {
		return { error: `exit ${result.code}: ${(result.stderr || result.stdout).slice(0, 200)}` };
	}
	const envelope = JSON.parse(result.stdout) as {
		structured_output?: { url?: string };
		total_cost_usd?: number;
		usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
	};
	const usage = envelope.usage ?? {};
	return {
		url: envelope.structured_output?.url,
		costUsd: envelope.total_cost_usd,
		inputTokens:
			(usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
	};
};

const askCodex = async (system: string, user: string): Promise<Answer> => {
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
			"--ephemeral",
			"--skip-git-repo-check",
			"--output-schema",
			schemaPath,
			"-o",
			output,
			"-",
		],
		`${system}\n\n---\n\n${user}`,
	);
	if (result.code !== 0) {
		return { error: `exit ${result.code}: ${(result.stderr || result.stdout).slice(-200)}` };
	}
	return { url: (JSON.parse(await readFile(output, "utf8")) as { url?: string }).url };
};

// ------------------------------------------------------------------------ items

const tasks = await loadNavTasks();
const hops = await loadHops();
const outputs = new Map<string, Map<string, string>>();
for (const [id] of PIPELINES) {
	const byPage = new Map<string, string>();
	for (const line of (await readFile(path.join(OUT_DIR, `${id}.outputs.jsonl`), "utf8")).split("\n")) {
		if (line.trim()) {
			const row = JSON.parse(line) as { id: string; markdown: string };
			byPage.set(row.id, row.markdown);
		}
	}
	outputs.set(id, byPage);
}
const finalUrls = new Map<string, string>();
for (const hop of hops) {
	if (!finalUrls.has(hop.pageUrl)) {
		finalUrls.set(hop.pageUrl, (await readPage(hop.pageUrl))?.finalUrl ?? hop.pageUrl);
	}
}

/** Correct answers for a task on a page: the next links of its golden paths there, and its sources. */
const accepted = (hop: Hop): Set<string> => {
	const set = new Set(
		hops.filter((other) => other.task === hop.task && other.pageUrl === hop.pageUrl).map((other) => other.target),
	);
	for (const source of tasks[hop.task].sources) {
		const url = normalizeUrl(source, source);
		if (url) {
			set.add(url);
		}
	}
	return set;
};

// One item per task and page: two paths of a task through the same page ask the same question.
const items = [...new Map(hops.map((hop) => [`${hop.task} ${hop.pageUrl}`, hop])).values()].slice(0, limit);
const itemKey = (hop: Hop): string => `${hop.task}-${hop.path}-${hop.step}`;

const answerFile = (model: string, rep: number, pipeline: string, hop: Hop): string =>
	path.join(CHOICES_DIR, `${model}-r${rep}`, pipeline, `${itemKey(hop)}.json`);

const readAnswer = async (file: string): Promise<Answer | undefined> => {
	try {
		return JSON.parse(await readFile(file, "utf8")) as Answer;
	} catch {
		return undefined;
	}
};

// ------------------------------------------------------------------------ run

if (!reportOnly) {
	const jobs: (() => Promise<void>)[] = [];
	for (const model of models) {
		for (let rep = 0; rep < reps; rep++) {
			for (const [pipeline] of PIPELINES) {
				for (const hop of items) {
					jobs.push(async () => {
						const file = answerFile(model, rep, pipeline, hop);
						if (await readAnswer(file)) {
							return;
						}
						const markdown = outputs.get(pipeline)?.get(hop.pageUrl) ?? "";
						const finalUrl = finalUrls.get(hop.pageUrl) ?? hop.pageUrl;
						if (markdownLinks(markdown, finalUrl).length === 0) {
							await mkdir(path.dirname(file), { recursive: true });
							await writeFile(file, JSON.stringify({ error: "no links in output" }));
							return;
						}
						const user = `Question: ${
							tasks[hop.task].question
						}\n\nCurrent page: ${finalUrl}\n\n<page>\n${markdown.slice(0, MAX_CHARS)}\n</page>`;
						let answer = await MODELS[model].ask(SYSTEM, user);
						if (answer.error) {
							answer = await MODELS[model].ask(SYSTEM, user);
						}
						if (answer.error) {
							console.warn(`${model} r${rep} ${pipeline} ${itemKey(hop)}: ${answer.error}`);
							return;
						}
						await mkdir(path.dirname(file), { recursive: true });
						await writeFile(file, JSON.stringify(answer));
					});
				}
			}
		}
	}
	console.info(
		`${items.length} items × ${PIPELINES.length} pipelines × ${models.join("+")} × ${reps} rep(s): ${jobs.length} jobs`,
	);
	let done = 0;
	const worker = async (): Promise<void> => {
		for (let job = jobs.shift(); job; job = jobs.shift()) {
			await job();
			done += 1;
			if (done % 200 === 0) {
				console.info(`  ${done} done`);
			}
		}
	};
	await Promise.all(Array.from({ length: concurrency }, worker));
}

// ------------------------------------------------------------------------ report

const tokens = new Map<string, Record<string, number>>();
for (const [id] of PIPELINES) {
	tokens.set(id, JSON.parse(await readFile(path.join(OUT_DIR, `${id}.tokens.json`), "utf8")) as Record<string, number>);
}
const site = (hop: Hop): string => tasks[hop.task].site;

/** Per model, pipeline and item: share of reps answered correctly (undefined when unanswered). */
const correctness = async (model: string, pipeline: string): Promise<Map<string, number>> => {
	const result = new Map<string, number>();
	for (const hop of items) {
		let right = 0;
		let answered = 0;
		for (let rep = 0; rep < reps; rep++) {
			const answer = await readAnswer(answerFile(model, rep, pipeline, hop));
			if (!answer) {
				continue;
			}
			answered += 1;
			const finalUrl = finalUrls.get(hop.pageUrl) ?? hop.pageUrl;
			const chosen = answer.url ? normalizeUrl(answer.url, finalUrl) : undefined;
			const inOutput =
				chosen !== undefined &&
				markdownLinks(outputs.get(pipeline)?.get(hop.pageUrl) ?? "", finalUrl).some((link) => link.url === chosen);
			if (inOutput && chosen && accepted(hop).has(chosen)) {
				right += 1;
			}
		}
		if (answered > 0) {
			result.set(itemKey(hop), right / answered);
		}
	}
	return result;
};

/** Paired difference a − b, bootstrapped over sites (items of one site resampled together). */
const pairedBySite = (a: Map<string, number>, b: Map<string, number>): string => {
	const bySite = new Map<string, number[]>();
	for (const hop of items) {
		const key = itemKey(hop);
		const x = a.get(key);
		const y = b.get(key);
		if (x !== undefined && y !== undefined) {
			const list = bySite.get(site(hop)) ?? [];
			list.push(x - y);
			bySite.set(site(hop), list);
		}
	}
	const sites = [...bySite.values()];
	const all = sites.flat();
	const mean = all.reduce((s, v) => s + v, 0) / Math.max(1, all.length);
	let seed = 1;
	const random = (): number => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const draws: number[] = [];
	for (let i = 0; i < 2000; i++) {
		let sum = 0;
		let count = 0;
		for (let s = 0; s < sites.length; s++) {
			const pick = sites[Math.floor(random() * sites.length)];
			sum += pick.reduce((t, v) => t + v, 0);
			count += pick.length;
		}
		draws.push(sum / Math.max(1, count));
	}
	draws.sort((x, y) => x - y);
	const f = (v: number): string => `${v >= 0 ? "+" : "−"}${Math.abs(100 * v).toFixed(1)}`;
	return `${f(mean)} [${f(draws[50])}, ${f(draws[1949])}]`;
};

const lines: string[] = [
	`# ${LINK_SET} next-link choice — ${new Date().toISOString().slice(0, 10)}`,
	"",
	`${items.length} items (task × page) from ${
		new Set(items.map(site)).size
	} sites. Accuracy in % (mean over ${reps} rep(s)); tokens: median o200k tokens of the page output.`,
	"",
];
const results = new Map<string, Map<string, Map<string, number>>>();
for (const model of models) {
	const perPipeline = new Map<string, Map<string, number>>();
	lines.push(
		`## ${MODELS[model].label}`,
		"",
		"| Pipeline | Accuracy | Answered | Median tokens |",
		"| --- | ---: | ---: | ---: |",
	);
	for (const [id, label] of PIPELINES) {
		const scores = await correctness(model, id);
		perPipeline.set(id, scores);
		const values = [...scores.values()];
		const pageTokens = items.map((hop) => tokens.get(id)?.[hop.pageUrl] ?? 0).sort((x, y) => x - y);
		lines.push(
			`| ${label} | ${((100 * values.reduce((s, v) => s + v, 0)) / Math.max(1, values.length)).toFixed(1)} | ${
				values.length
			}/${items.length} | ${pageTokens[Math.floor(pageTokens.length / 2)].toLocaleString("en-US")} |`,
		);
	}
	results.set(model, perPipeline);
	const agent = perPipeline.get("webforai-agent") ?? new Map();
	lines.push(
		"",
		"Paired differences in points, 95% CI bootstrapped over sites:",
		"",
		`- agent − all links: ${pairedBySite(agent, perPipeline.get("webforai-all-links") ?? new Map())}`,
		`- agent − agent without role headings: ${pairedBySite(
			agent,
			perPipeline.get("webforai-agent-flat") ?? new Map(),
		)}`,
		`- agent with same-site links as paths − agent: ${pairedBySite(
			perPipeline.get("webforai-agent-compact") ?? new Map(),
			agent,
		)}`,
		`- agent − node-html-markdown: ${pairedBySite(agent, perPipeline.get("node-html-markdown") ?? new Map())}`,
		`- agent − readability: ${pairedBySite(agent, perPipeline.get("webforai") ?? new Map())}`,
		"",
	);
}
const report = lines.join("\n");
await writeFile(path.join(OUT_DIR, "choose.md"), report);
console.info(report);
