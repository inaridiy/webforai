/**
 * WCXB (Foley, arXiv:2605.21097, 2026): 2,008 pages from 1,613 domains in seven page types
 * (article, forum, product, collection, listing, documentation, service), with a 1,497-page dev
 * split and a 511-page held-out test split. CC BY 4.0. Used here strictly as an external holdout.
 *
 * Fetch once (≈85 MB) into the gitignored cache:
 *
 *   pnpm --filter @webforai/evals gold:fetch-wcxb
 *
 * Scored like the benchmark's `evaluate.py`: bag-of-words precision, recall and F1 against
 * `ground_truth.main_content`, with its tokenizer (Python's `re.findall(r"\w+", text.lower())`).
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { CACHE_DIR } from "../config.js";
import type { GoldPage } from "./wceb.js";

export const WCXB_DIR = path.join(CACHE_DIR, "gold", "wcxb");

export type WcxbSplit = "dev" | "test";

/**
 * Python's Unicode `\w`: letters, numbers and `_`, but not combining marks; a run of CJK characters
 * is one token. `evaluate.py` lower-cases first.
 */
const WORD = /[\p{L}\p{N}_]+/gu;
export const tokenizeWcxb = (text: string): string[] => text.toLowerCase().match(WORD) ?? [];

interface GroundTruth {
	url?: string;
	ground_truth: { main_content?: string | null };
	_internal?: { page_type?: { primary?: string } };
}

/** `evaluate.py` maps `category` to `collection` and defaults a missing type to `article`. */
const pageType = (truth: GroundTruth): string => {
	const primary = truth._internal?.page_type?.primary ?? "article";
	return primary === "category" ? "collection" : primary;
};

export const loadWcxb = async (split: WcxbSplit): Promise<GoldPage[]> => {
	const truthDir = path.join(WCXB_DIR, split, "ground-truth");
	const htmlDir = path.join(WCXB_DIR, split, "html");
	const pages: GoldPage[] = [];
	for (const file of (await readdir(truthDir)).filter((name) => name.endsWith(".json")).sort()) {
		const id = file.slice(0, -".json".length);
		const truth = JSON.parse(await readFile(path.join(truthDir, file), "utf8")) as GroundTruth;
		pages.push({
			id: `wcxb-${split}/${id}`,
			dataset: `wcxb-${split}/${pageType(truth)}`,
			url: truth.url,
			gold: truth.ground_truth.main_content ?? "",
			readHtml: async () =>
				gunzipSync(new Uint8Array(await readFile(path.join(htmlDir, `${id}.html.gz`)))).toString("utf8"),
			tokenize: tokenizeWcxb,
		});
	}
	return pages;
};
