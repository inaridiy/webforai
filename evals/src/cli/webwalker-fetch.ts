/**
 * Resolves WebWalkerQA's golden paths to URLs on the live sites and caches the pages clicked on.
 *
 * Usage:
 *   pnpm --filter @webforai/evals webwalker:fetch                # English tasks
 *   pnpm --filter @webforai/evals webwalker:fetch -- --limit=50
 *
 * Downloads the dataset to `.cache/gold/webwalkerqa/` on first use. Pages are rendered in headless
 * Chromium (many of these sites build their menus in JavaScript), one at a time per host, and the
 * rendered DOM is cached in `.cache/webwalker/html/`, failures included. `WEBWALKER_CHROMIUM`
 * points at a Chromium binary when playwright-core's own is not installed.
 *
 * For each label the page's anchors are matched by text (`textKey`): exact matches first, else
 * anchors whose text contains the label or is contained in it. When several distinct URLs match,
 * up to three are tried and the first from which the rest of the path resolves wins. A page that
 * links to the task's source page directly ends the path with that click, whatever the remaining
 * labels say (some are buttons such as "Close"); the last click must reach the source page. Writes
 * `.cache/webwalker/hops.jsonl` and prints how many paths resolved and why the others did not.
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { type Browser, chromium } from "playwright-core";
import { fetch as undiciFetch } from "undici";

import { USER_AGENT } from "../config.js";
import {
	type CachedPage,
	HOPS_FILE,
	type Hop,
	WEBWALKER_DATA,
	WEBWALKER_DATA_URL,
	WEBWALKER_DIR,
	htmlAnchors,
	isEnglish,
	loadTasks,
	normalizeUrl,
	readPage,
	textKey,
	writePage,
} from "../webwalker.js";

const arg = (name: string): string | undefined =>
	process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const limit = Number(arg("limit") ?? Number.POSITIVE_INFINITY);
/** Distinct URLs tried when a label matches several links. */
const MAX_CANDIDATES = 3;

if (!(await stat(WEBWALKER_DATA).catch(() => undefined))) {
	await mkdir(path.dirname(WEBWALKER_DATA), { recursive: true });
	const response = await undiciFetch(WEBWALKER_DATA_URL);
	await writeFile(WEBWALKER_DATA, await response.text());
}

// One request at a time per host, with a pause: these are small conference and society sites.
const hostQueues = new Map<string, Promise<unknown>>();
const politely = <T>(url: string, task: () => Promise<T>): Promise<T> => {
	const host = new URL(url).hostname;
	const previous = hostQueues.get(host) ?? Promise.resolve();
	const next = previous.then(
		() => task().finally(() => new Promise((resolve) => setTimeout(resolve, 500))),
		() => task(),
	);
	hostQueues.set(
		host,
		next.catch(() => undefined),
	);
	return next;
};

let browser: Promise<Browser> | undefined;
/** Pages open at once, across hosts. */
const MAX_OPEN = 6;
let open = 0;
const waiting: (() => void)[] = [];
const slot = async (): Promise<() => void> => {
	if (open >= MAX_OPEN) {
		await new Promise<void>((resolve) => waiting.push(resolve));
	}
	open += 1;
	return () => {
		open -= 1;
		waiting.shift()?.();
	};
};

const render = async (url: string): Promise<CachedPage> => {
	browser ??= chromium.launch({
		headless: true,
		executablePath: process.env.WEBWALKER_CHROMIUM,
		args: ["--no-sandbox"],
	});
	const release = await slot();
	const context = await (await browser).newContext({
		userAgent: USER_AGENT,
		viewport: { width: 1440, height: 900 },
		locale: "en-US",
	});
	try {
		const page = await context.newPage();
		const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
		const contentType = (await response?.headerValue("content-type")) ?? "";
		if (!contentType.includes("html")) {
			return { url, finalUrl: page.url(), status: response?.status() ?? 0, contentType, html: "" };
		}
		// `networkidle` never settles on pages with long-polling, so cap the extra settle time.
		await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
		return { url, finalUrl: page.url(), status: response?.status() ?? 0, contentType, html: await page.content() };
	} catch (error) {
		return { url, finalUrl: url, status: 0, contentType: "", html: "", error: (error as Error).message.split("\n")[0] };
	} finally {
		await context.close().catch(() => undefined);
		release();
	}
};

const getPage = async (url: string): Promise<CachedPage> => {
	const cached = await readPage(url);
	if (cached) {
		return cached;
	}
	return politely(url, async () => {
		const page = await render(url);
		await writePage(page);
		return page;
	});
};

type Resolution = { hops: Omit<Hop, "task" | "path">[] } | { failure: string };

const resolve = async (url: string, labels: string[], target: string, step: number): Promise<Resolution> => {
	const page = await getPage(url);
	if (!page.html || page.status >= 400) {
		return { failure: `fetch: ${page.error ?? `HTTP ${page.status} ${page.contentType}`}` };
	}
	const anchors = htmlAnchors(page.html, page.finalUrl);
	const [label, ...rest] = labels;
	const hop = (targetHref: string, targetUrl: string) => ({
		step,
		pageUrl: url,
		finalUrl: page.finalUrl,
		label,
		targetHref,
		target: targetUrl,
	});
	// A path may end early: some labels are buttons ("Close", "Next") on the page that is already the
	// source, and a page on the way may link to the source directly, as an agent would then click.
	if (step > 0 && normalizeUrl(page.finalUrl, page.finalUrl) === target) {
		return { hops: [] };
	}
	const direct = anchors.find((anchor) => anchor.url === target);
	if (direct) {
		return { hops: [hop(direct.href, direct.url)] };
	}
	if (rest.length === 0) {
		return { failure: "source page not linked from the last page" };
	}
	const key = textKey(label);
	const exact = anchors.filter((a) => a.key === key);
	const partial = anchors.filter(
		(a) => (key.length >= 4 && a.key.includes(key)) || (a.key.length >= 8 && key.includes(a.key)),
	);
	const candidates = [...new Map((exact.length > 0 ? exact : partial).map((a) => [a.url, a])).values()];
	if (candidates.length === 0) {
		return { failure: "label not found" };
	}
	let failure = "";
	for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
		const next = await resolve(candidate.href, rest, target, step + 1);
		if ("hops" in next) {
			return { hops: [hop(candidate.href, candidate.url), ...next.hops] };
		}
		failure = next.failure;
	}
	return { failure };
};

const tasks = await loadTasks();
const english = tasks.map((task, index) => ({ task, index })).filter(({ task }) => isEnglish(task));
const selected = english.slice(0, limit);

const hops: Hop[] = [];
const failures = new Map<string, number>();
let paths = 0;
let resolved = 0;

await Promise.all(
	selected.map(async ({ task, index }) => {
		const { golden_path: goldenPaths, source_website: sources } = task.info;
		for (const [pathIndex, goldenPath] of goldenPaths.entries()) {
			paths += 1;
			const labels = goldenPath.split("->").slice(1);
			const source = sources[pathIndex] ?? sources[0];
			const target = normalizeUrl(source, source);
			const result =
				labels.length > 0 && target
					? await resolve(task.root_url, labels, target, 0)
					: { failure: "empty path" as const };
			if ("hops" in result) {
				resolved += 1;
				hops.push(...result.hops.map((hop) => ({ task: index, path: pathIndex, ...hop })));
			} else {
				const reason = result.failure.replace(/HTTP \d+.*/, "HTTP error");
				failures.set(reason, (failures.get(reason) ?? 0) + 1);
			}
		}
	}),
);

await (await browser)?.close();
hops.sort((a, b) => a.task - b.task || a.path - b.path || a.step - b.step);
await mkdir(WEBWALKER_DIR, { recursive: true });
await writeFile(HOPS_FILE, `${hops.map((hop) => JSON.stringify(hop)).join("\n")}\n`);

const tasksResolved = new Set(hops.map((hop) => hop.task)).size;
console.info(`${selected.length} English tasks, ${paths} golden paths: ${resolved} resolved (${tasksResolved} tasks)`);
console.info(`${hops.length} hops written to ${path.relative(process.cwd(), HOPS_FILE)}`);
for (const [reason, count] of [...failures].sort((a, b) => b[1] - a[1])) {
	console.info(`  ${count} × ${reason}`);
}
