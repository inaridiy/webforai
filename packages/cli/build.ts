import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import packageInfo from "./package.json";
import { renderSkillMarkdown } from "./src/commands/skill/content";

// One ESM file with a shebang. Dependencies stay external: they are installed from this
// package's `dependencies`, and `webforai` is the published library, not a copy of it.
await build({
	entryPoints: ["./src/bin.ts"],
	banner: { js: "#!/usr/bin/env node" },
	outfile: "./dist/bin.js",
	platform: "node",
	format: "esm",
	bundle: true,
	packages: "external",
	logLevel: "info",
});

// The Agent Skill ships in the package too, so `pi install npm:webforai-cli` finds it
// (`pi.skills` in package.json); `webforai skill` prints the same text.
await mkdir("./dist/skills/webforai", { recursive: true });
await writeFile("./dist/skills/webforai/SKILL.md", renderSkillMarkdown(packageInfo.version));
