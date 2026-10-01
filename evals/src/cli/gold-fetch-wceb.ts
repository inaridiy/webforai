/**
 * Downloads the WCEB combined dataset (≈50 MB, Apache-2.0) into the gitignored cache.
 *
 * Usage:
 *   pnpm --filter @webforai/evals gold:fetch-wceb
 */

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { WCEB_DIR } from "../gold/wceb.js";

const URL =
	"https://media.githubusercontent.com/media/chatnoir-eu/web-content-extraction-benchmark/main/datasets/combined.tar.xz";

const target = path.dirname(WCEB_DIR);
await mkdir(target, { recursive: true });

const response = await fetch(URL);
if (!response.ok) {
	throw new Error(`WCEB download failed: ${response.status}`);
}
const archive = path.join(target, "combined.tar.xz");
await writeFile(archive, new Uint8Array(await response.arrayBuffer()));
execFileSync("tar", ["xJf", archive, "-C", target]);
console.log(`WCEB extracted to ${WCEB_DIR}`);
