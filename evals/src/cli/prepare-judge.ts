/**
 * Prepares blinded A/B pairs for LLM judging.
 *
 * Each corpus page is converted by both the published v2 baseline and the working tree, and the
 * two outputs are written as `A.md` and `B.md`. Which version lands in which slot is decided by a
 * hash of the site id — stable across runs, but not guessable from the file itself — and the
 * mapping is written to a separate file that judges are not given.
 *
 * Blinding matters here: an unblinded judge told that one output is "the new version" tends to
 * find reasons to prefer it, which would make the evaluation worthless as evidence.
 *
 * Usage:
 *   pnpm --filter @webforai/evals judge:prepare
 */

import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { htmlToMarkdown as htmlToMarkdownV3 } from "webforai";
import { htmlToMarkdown as htmlToMarkdownV2 } from "webforai-v2";

import { REPORTS_DIR } from "../config.js";
import { CORPUS, type CorpusSite } from "../corpus.js";
import { type RenderMode, readCached } from "../fetch.js";

/**
 * Characters kept from the head and tail of each document.
 *
 * Judges have a finite context, and several corpus pages exceed 100 KB. Sampling both ends keeps
 * the comparison affordable while still exposing truncation and trailing-boilerplate defects,
 * which a head-only sample would hide. Both sides are cut identically so neither is favoured.
 */
const HEAD_CHARS = 7000;
const TAIL_CHARS = 2500;

const PAIRS_DIR = path.join(REPORTS_DIR, "judge", "pairs");
const MAPPING_PATH = path.join(REPORTS_DIR, "judge", "mapping.json");

const sample = (markdown: string): string => {
	if (markdown.length <= HEAD_CHARS + TAIL_CHARS) {
		return markdown;
	}
	const head = markdown.slice(0, HEAD_CHARS);
	const tail = markdown.slice(-TAIL_CHARS);
	const omitted = markdown.length - HEAD_CHARS - TAIL_CHARS;
	return `${head}\n\n[... ${omitted} characters omitted from the middle ...]\n\n${tail}`;
};

/** Deterministic, non-obvious slot assignment. */
const assignsV3ToA = (id: string): boolean => createHash("sha1").update(id).digest()[0] % 2 === 0;

const modesFor = (site: CorpusSite): RenderMode[] => (site.render === "both" ? ["static"] : [site.render]);

const convert = (fn: (html: string, url: string) => string, html: string, url: string): string => {
	try {
		return fn(html, url);
	} catch (error) {
		return `[conversion failed: ${(error as Error).message}]`;
	}
};

await rm(path.join(REPORTS_DIR, "judge"), { recursive: true, force: true });
await mkdir(PAIRS_DIR, { recursive: true });

const mapping: Record<string, { url: string; category: string; aIs: "v2" | "v3"; v2Chars: number; v3Chars: number }> =
	{};

for (const site of CORPUS) {
	for (const mode of modesFor(site)) {
		const html = await readCached(site.id, mode, site.url);
		if (!html) {
			continue;
		}

		const v2 = convert((h, u) => htmlToMarkdownV2(h, { baseUrl: u }) as string, html, site.url);
		const v3 = convert((h, u) => htmlToMarkdownV3(h, { baseUrl: u, url: u }), html, site.url);

		const key = `${site.id}.${mode}`;
		const v3IsA = assignsV3ToA(key);

		await mkdir(path.join(PAIRS_DIR, key), { recursive: true });
		await writeFile(path.join(PAIRS_DIR, key, "A.md"), sample(v3IsA ? v3 : v2));
		await writeFile(path.join(PAIRS_DIR, key, "B.md"), sample(v3IsA ? v2 : v3));
		await writeFile(
			path.join(PAIRS_DIR, key, "SOURCE.txt"),
			`url: ${site.url}\ncategory: ${site.category}\nfull length A: ${(v3IsA ? v3 : v2).length}\nfull length B: ${
				(v3IsA ? v2 : v3).length
			}\n`,
		);

		mapping[key] = {
			url: site.url,
			category: site.category,
			aIs: v3IsA ? "v3" : "v2",
			v2Chars: v2.length,
			v3Chars: v3.length,
		};
	}
}

await writeFile(MAPPING_PATH, JSON.stringify(mapping, null, 2));

console.info(`${Object.keys(mapping).length} blinded pairs written to ${PAIRS_DIR}`);
console.info(`mapping (judges must NOT read this): ${MAPPING_PATH}`);
