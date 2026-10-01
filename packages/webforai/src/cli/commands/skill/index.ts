import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import packageInfo from "../../../../package.json";
import { renderSkillMarkdown } from "./content";

export interface SkillFlags {
	install?: boolean;
	/** Direct-write escape hatch: skip the `skills` CLI and write into this skills directory. */
	dir?: string;
	// Forwarded verbatim to `skills add`; their semantics are the skills CLI's, not ours.
	global?: boolean;
	agent?: string;
	yes?: boolean;
	copy?: boolean;
	all?: boolean;
}

/** Builds the `npx skills add <source>` argv from our pass-through flags (pure, for tests). */
export const buildSkillsAddArgs = (source: string, flags: SkillFlags): string[] => {
	const args = ["-y", "skills", "add", source];
	if (flags.global) {
		args.push("--global");
	}
	if (flags.agent) {
		args.push("--agent", flags.agent);
	}
	if (flags.yes) {
		args.push("-y");
	}
	if (flags.copy) {
		args.push("--copy");
	}
	if (flags.all) {
		args.push("--all");
	}
	return args;
};

const runSkillsAdd = (args: string[]): Promise<number> =>
	new Promise((resolve, reject) => {
		// stdio inherit: the skills CLI's interactive agent picker must reach the terminal.
		const child = spawn("npx", args, { stdio: ["inherit", "inherit", "inherit"] });
		child.on("error", reject);
		child.on("close", (code) => resolve(code ?? 1));
	});

/**
 * `webforai skill` — print the Agent Skill; `--install` delegates placement to the
 * [`skills` CLI](https://github.com/vercel-labs/skills) (`npx skills add`), which manages
 * agent directories, symlinks/copies and the skills lockfile far more robustly than a
 * hand-rolled file write. `--dir` remains as an offline direct-write fallback.
 */
export const skillCommand = async (flags: SkillFlags): Promise<void> => {
	const markdown = renderSkillMarkdown(packageInfo.version);

	if (!(flags.install || flags.dir)) {
		process.stdout.write(markdown);
		return;
	}

	if (flags.dir) {
		const target = path.join(flags.dir, "webforai", "SKILL.md");
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, markdown);
		console.error(`[webforai] Agent Skill written to ${target}`);
		return;
	}

	// A temp dir shaped like a skill repository (<dir>/webforai/SKILL.md) is the source; the
	// skills CLI takes it from there. Content comes from this binary, so it always matches the
	// installed CLI version.
	const stage = await fs.mkdtemp(path.join(os.tmpdir(), "webforai-skill-"));
	try {
		await fs.mkdir(path.join(stage, "webforai"), { recursive: true });
		await fs.writeFile(path.join(stage, "webforai", "SKILL.md"), markdown);

		const args = buildSkillsAddArgs(stage, flags);
		console.error(`[webforai] running: npx ${args.join(" ")}`);
		const code = await runSkillsAdd(args).catch((error: unknown) => {
			console.error(
				`[webforai] could not launch the skills CLI (${error instanceof Error ? error.message : String(error)}).`,
			);
			console.error("[webforai] fallback: `webforai skill --dir .claude/skills` writes the file directly.");
			return 1;
		});
		if (code !== 0) {
			process.exitCode = 1;
		}
	} finally {
		await fs.rm(stage, { recursive: true, force: true });
	}
};
