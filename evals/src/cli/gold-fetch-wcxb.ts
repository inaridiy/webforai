/**
 * Downloads WCXB v1.0 (≈85 MB, CC BY 4.0) into the gitignored cache.
 *
 * Usage:
 *   pnpm --filter @webforai/evals gold:fetch-wcxb
 */

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { WCXB_DIR } from "../gold/wcxb.js";

const URL = "https://codeload.github.com/Murrough-Foley/web-content-extraction-benchmark/tar.gz/refs/tags/v1.0";

await mkdir(WCXB_DIR, { recursive: true });
const response = await fetch(URL);
if (!response.ok) {
	throw new Error(`WCXB download failed: ${response.status}`);
}
const archive = path.join(path.dirname(WCXB_DIR), "wcxb-v1.0.tar.gz");
await writeFile(archive, new Uint8Array(await response.arrayBuffer()));
execFileSync("tar", ["xzf", archive, "-C", WCXB_DIR, "--strip-components=1"]);
console.log(`WCXB extracted to ${WCXB_DIR}`);
