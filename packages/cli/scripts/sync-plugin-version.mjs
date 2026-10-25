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
const plugin = JSON.parse(fs.readFileSync(manifest, "utf8"));
if (plugin.version !== version) {
	plugin.version = version;
	fs.writeFileSync(manifest, `${JSON.stringify(plugin, null, "\t")}\n`);
}
