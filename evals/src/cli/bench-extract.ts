/**
 * Extraction-stage benchmark.
 *
 * The end-to-end benchmark understates changes to the extractor, because HTML parsing and the
 * HAST-to-MDAST conversion together account for roughly two thirds of a conversion and neither
 * is ours. This isolates the extraction stage: trees are parsed once per round, outside the
 * timed region, so only extraction is measured.
 *
 * Usage:
 *   pnpm --filter @webforai/evals bench:extract
 */

import { fromHtml } from "hast-util-from-html";
import { takumiExtractor as v3 } from "webforai";
import { takumiExtractor as v2 } from "webforai-v2";
import { CORPUS } from "../corpus.js";
import { readCached } from "../fetch.js";

const caps: { html: string; url: string }[] = [];
for (const site of CORPUS) {
	const modes = (site.render === "both" ? ["static", "rendered"] : [site.render]) as ("static" | "rendered")[];
	for (const mode of modes) {
		const html = await readCached(site.id, mode, site.url);
		if (html) {
			caps.push({ html, url: site.url });
		}
	}
}
// Parse once per round so parsing cost is excluded from the measurement.
const run = (fn: (p: any) => any) => {
	const trees = caps.map((c) => ({ hast: fromHtml(c.html, { fragment: true }), url: c.url }));
	const started = performance.now();
	for (const t of trees) {
		try {
			fn({ hast: t.hast, url: t.url, owned: true });
		} catch {
			// A conversion failure is a correctness concern, not a timing one.
		}
	}
	return performance.now() - started;
};
const med = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)];
run(v2);
run(v3);
const r2: number[] = [];
const r3: number[] = [];
for (let round = 0; round < 5; round++) {
	r2.push(run(v2));
	r3.push(run(v3));
}
console.log(
	`extraction only — v2 ${med(r2).toFixed(0)} ms   v3 ${med(r3).toFixed(0)} ms   ${(med(r2) / med(r3)).toFixed(2)}x`,
);
