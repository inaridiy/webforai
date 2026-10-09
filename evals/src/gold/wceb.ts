/**
 * The Web Content Extraction Benchmark (Bevendorff et al., SIGIR 2023): eight annotated
 * datasets in one format, used here strictly as an external holdout.
 *
 * Fetch once (≈50 MB, Apache-2.0) into the gitignored cache:
 *
 *   pnpm --filter @webforai/evals gold:fetch-wceb
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { CACHE_DIR } from "../config.js";

export const WCEB_DIR = path.join(CACHE_DIR, "gold", "wceb", "combined");

export const WCEB_DATASETS = [
	"cetd",
	"cleaneval",
	"cleanportaleval",
	"dragnet",
	"google-trends-2017",
	"l3s-gn1",
	"readability",
	"scrapinghub",
] as const;

export interface GoldPage {
	/** Stable identifier, `<dataset>/<page id>`. */
	id: string;
	dataset: string;
	url?: string;
	gold: string;
	readHtml: () => Promise<string>;
	/** The set's own tokenizer, when its published scorer differs from `text-metrics.ts`. */
	tokenize?: (text: string) => string[];
}

export const loadWceb = async (datasets: readonly string[] = WCEB_DATASETS): Promise<GoldPage[]> => {
	const pages: GoldPage[] = [];
	for (const dataset of datasets) {
		const htmlDir = path.join(WCEB_DIR, "html", dataset);
		const available = new Set(await readdir(htmlDir));
		const lines = (await readFile(path.join(WCEB_DIR, "ground-truth", `${dataset}.jsonl`), "utf8")).split("\n");
		for (const line of lines) {
			if (!line.trim()) {
				continue;
			}
			const row = JSON.parse(line) as { page_id: string; plaintext: string | null; url?: string };
			const file = `${row.page_id}.html`;
			if (!available.has(file)) {
				continue;
			}
			pages.push({
				id: `${dataset}/${row.page_id}`,
				dataset,
				url: row.url,
				gold: row.plaintext ?? "",
				readHtml: () => readFile(path.join(htmlDir, file), "utf8"),
			});
		}
	}
	return pages;
};
