/**
 * Downloads WebMainBench (1.35 GB, Apache 2.0) and splits it into one HTML file per page plus
 * `ground-truth.jsonl`, all in the gitignored cache. An already downloaded `webmainbench.jsonl`
 * is reused.
 *
 * Usage:
 *   pnpm --filter @webforai/evals gold:fetch-webmainbench
 */

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { WEBMAINBENCH_DIR, type WebMainBenchTruth } from "../gold/webmainbench.js";

const URL = "https://huggingface.co/datasets/opendatalab/WebMainBench/resolve/main/webmainbench.jsonl";
const source = path.join(WEBMAINBENCH_DIR, "webmainbench.jsonl");

await mkdir(path.join(WEBMAINBENCH_DIR, "html"), { recursive: true });
if (!(await stat(source).catch(() => undefined))) {
	const response = await fetch(URL);
	if (!(response.ok && response.body)) {
		throw new Error(`WebMainBench download failed: ${response.status}`);
	}
	await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(source));
}

interface Record {
	track_id: string;
	url: string;
	html: string;
	convert_main_content: string;
	meta: { level: string; language: string };
}

const truths: WebMainBenchTruth[] = [];
for await (const line of createInterface({
	input: createReadStream(source, "utf8"),
	crlfDelay: Number.POSITIVE_INFINITY,
})) {
	if (!line.trim()) {
		continue;
	}
	const record = JSON.parse(line) as Record;
	await writeFile(path.join(WEBMAINBENCH_DIR, "html", `${record.track_id}.html`), record.html);
	truths.push({
		id: record.track_id,
		url: record.url,
		level: record.meta.level,
		language: record.meta.language,
		markdown: record.convert_main_content,
	});
}
await writeFile(path.join(WEBMAINBENCH_DIR, "ground-truth.jsonl"), truths.map((t) => JSON.stringify(t)).join("\n"));
console.log(`WebMainBench: ${truths.length} pages in ${WEBMAINBENCH_DIR}`);
