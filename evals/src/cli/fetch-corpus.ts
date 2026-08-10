/**
 * Populates the local corpus cache.
 *
 * Usage:
 *   pnpm --filter @webforai/evals corpus:fetch
 *   pnpm --filter @webforai/evals corpus:fetch -- --force --only=github-issue,zenn-article
 *   pnpm --filter @webforai/evals corpus:status
 */

import type { Browser } from "playwright-core";

import { CORPUS, type CorpusSite } from "../corpus.js";
import { createPool, fetchRendered, fetchStatic, isCached } from "../fetch.js";

const args = process.argv.slice(2);
const hasFlag = (name: string): boolean => args.includes(`--${name}`);
const flagValue = (name: string): string | undefined =>
	args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const force = hasFlag("force");
const statusOnly = hasFlag("status");
const only = flagValue("only")
	?.split(",")
	.map((id) => id.trim())
	.filter(Boolean);
const category = flagValue("category");
const concurrency = Number(flagValue("concurrency") ?? 6);

const selected = CORPUS.filter((site) => {
	if (only && !only.includes(site.id)) {
		return false;
	}
	if (category && site.category !== category) {
		return false;
	}
	return true;
});

/** Which capture modes a site needs, expanded from its `render` field. */
const modesFor = (site: CorpusSite): Array<"static" | "rendered"> =>
	site.render === "both" ? ["static", "rendered"] : [site.render];

if (statusOnly) {
	let cachedCount = 0;
	let total = 0;

	for (const site of selected) {
		for (const mode of modesFor(site)) {
			total += 1;
			const present = await isCached(site.id, mode, site.url);
			if (present) {
				cachedCount += 1;
			} else {
				console.info(`missing  ${site.id} [${mode}]`);
			}
		}
	}

	console.info(`\n${cachedCount}/${total} captures cached`);
	process.exit(0);
}

const pool = await createPool();
console.info(`Proxy pool: ${pool.size === 0 ? "direct connection" : `${pool.size} endpoints`}`);
console.info(`Fetching ${selected.length} sites (concurrency ${concurrency}, force=${force})\n`);

const browserRef: { browser?: Browser } = {};
const failures: Array<{ id: string; mode: string; error: string }> = [];
let completed = 0;

/**
 * Static captures run concurrently, rendered captures run one at a time.
 *
 * Chromium contexts are heavy and several publishers throttle hard under parallel navigation,
 * so serialising the browser work trades a little wall clock for a much better success rate.
 */
const staticJobs: CorpusSite[] = [];
const renderedJobs: CorpusSite[] = [];

for (const site of selected) {
	const modes = modesFor(site);
	if (modes.includes("static")) {
		staticJobs.push(site);
	}
	if (modes.includes("rendered")) {
		renderedJobs.push(site);
	}
}

const runStatic = async (site: CorpusSite): Promise<void> => {
	try {
		const html = await fetchStatic(site, pool, { force });
		console.info(`ok       ${site.id} [static] ${(html.length / 1024).toFixed(0)}KB`);
	} catch (error) {
		failures.push({ id: site.id, mode: "static", error: (error as Error).message });
		console.info(`FAILED   ${site.id} [static]`);
	} finally {
		completed += 1;
	}
};

// Simple worker-pool over the static jobs.
const queue = [...staticJobs];
await Promise.all(
	Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
		for (;;) {
			const site = queue.shift();
			if (!site) {
				return;
			}
			await runStatic(site);
		}
	}),
);

for (const site of renderedJobs) {
	try {
		const html = await fetchRendered(site, pool, browserRef, { force });
		console.info(`ok       ${site.id} [rendered] ${(html.length / 1024).toFixed(0)}KB`);
	} catch (error) {
		failures.push({ id: site.id, mode: "rendered", error: (error as Error).message });
		console.info(`FAILED   ${site.id} [rendered]`);
	} finally {
		completed += 1;
	}
}

await browserRef.browser?.close();

console.info(`\n${completed - failures.length}/${completed} captures succeeded`);
if (failures.length > 0) {
	console.info("\nFailures:");
	for (const failure of failures) {
		console.info(`  ${failure.id} [${failure.mode}]\n    ${failure.error.split("\n").join("\n    ")}`);
	}
}
