/**
 * WebMainBench (OpenDataLab; Dripper, arXiv:2511.23119): 7,809 human-annotated pages from 5,434
 * domains in 46 languages, split by DOM complexity into simple, mid and hard. Apache 2.0. Used
 * here strictly as an external holdout.
 *
 * Fetch once (1.35 GB) and split into one HTML file per page in the gitignored cache:
 *
 *   pnpm --filter @webforai/evals gold:fetch-webmainbench
 *
 * The reference is `convert_main_content`, the annotated main HTML converted with html2text. The
 * harness scores it with the bag-of-tokens metric after `markdownToPlain`; the benchmark's own
 * ROUGE-5 is computed by `python/webmainbench_rouge.py` from outputs saved by `gold:eval`.
 *
 * The page HTML carries the annotation (`cc-select`, `data-anno-uid` attributes). It is passed to
 * every pipeline unchanged, as the benchmark's own baselines receive it; no pipeline here reads
 * those attributes.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { CACHE_DIR } from "../config.js";
import { markdownToPlain } from "./text-metrics.js";
import type { GoldPage } from "./wceb.js";

export const WEBMAINBENCH_DIR = path.join(CACHE_DIR, "gold", "webmainbench");

/** One line of `ground-truth.jsonl`, written by `gold:fetch-webmainbench`. */
export interface WebMainBenchTruth {
	id: string;
	url: string;
	level: string;
	language: string;
	/** `convert_main_content`: html2text Markdown of the annotated main content. */
	markdown: string;
}

export const loadWebMainBenchTruth = async (): Promise<WebMainBenchTruth[]> =>
	(await readFile(path.join(WEBMAINBENCH_DIR, "ground-truth.jsonl"), "utf8"))
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as WebMainBenchTruth);

export const loadWebMainBench = async (): Promise<GoldPage[]> =>
	(await loadWebMainBenchTruth()).map((truth) => ({
		id: `webmainbench/${truth.id}`,
		dataset: `webmainbench/${truth.level}`,
		url: truth.url,
		gold: markdownToPlain(truth.markdown),
		readHtml: () => readFile(path.join(WEBMAINBENCH_DIR, "html", `${truth.id}.html`), "utf8"),
	}));
