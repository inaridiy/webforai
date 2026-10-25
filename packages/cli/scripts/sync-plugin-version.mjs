// @ts-check
/**
 * Copies the webforai-cli version into the repository-root `plugin.json` (the Agent Plugins
 * manifest that Codex, Cursor and Copilot CLI read). Run by the root `ci:version` script right
 * after `changeset version`, so the release PR bumps both; clients refresh a cached plugin
 * when its version changes. `src/plugin-manifest.test.ts` fails if they drift.
 */
import fs from "node:fs";

const cliPackage = new URL("../package.json", import.meta.url);
const manifest = new URL("../../../plugin.json", import.meta.url);

const { version } = JSON.parse(fs.readFileSync(cliPackage, "utf8"));
// Replace the value in place: re-serializing would undo biome's formatting of the file.
const text = fs.readFileSync(manifest, "utf8");
const next = text.replace(/("version":\s*)"[^"]*"/u, `$1"${version}"`);
if (next === text && JSON.parse(text).version !== version) {
	throw new Error('plugin.json has no "version" field to update');
}
fs.writeFileSync(manifest, next);
