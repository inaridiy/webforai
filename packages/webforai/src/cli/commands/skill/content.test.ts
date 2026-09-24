import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderSkillMarkdown } from "./content";
import { buildSkillsAddArgs } from "./index";

/** Every public flag of the main command; the skill must document each one. */
const PUBLIC_FLAGS = [
	"--output",
	"--loader",
	"--mode",
	"--extractor",
	"--frontmatter",
	"--json",
	"--engine",
	"--region",
	"--screenshot",
	"--respect-robots",
	"--api-key",
	"--platform-url",
	"--interactive",
	"--debug",
];

describe("renderSkillMarkdown", () => {
	const markdown = renderSkillMarkdown("9.9.9");

	it("is a valid Agent Skill: frontmatter with name and description", () => {
		expect(markdown.startsWith("---\nname: webforai\ndescription: ")).toBe(true);
		expect(markdown).toContain("\n---\n");
	});

	it("documents every public flag", () => {
		for (const flag of PUBLIC_FLAGS) {
			expect(markdown, `flag ${flag} missing from the skill`).toContain(flag);
		}
	});

	it("mentions the version when given, omits it otherwise", () => {
		expect(markdown).toContain("(v9.9.9)");
		expect(renderSkillMarkdown()).not.toContain("(v");
	});

	it("matches the copy committed at skills/webforai/SKILL.md (repo install channel)", () => {
		const committedPath = fileURLToPath(new URL("../../../../../../skills/webforai/SKILL.md", import.meta.url));
		expect(readFileSync(committedPath, "utf-8")).toBe(renderSkillMarkdown());
	});
});

describe("buildSkillsAddArgs", () => {
	it("always goes through `npx -y skills add <source>`", () => {
		expect(buildSkillsAddArgs("/tmp/stage", {})).toEqual(["-y", "skills", "add", "/tmp/stage"]);
	});

	it("forwards the pass-through flags verbatim", () => {
		expect(
			buildSkillsAddArgs("/s", { global: true, agent: "claude-code,cursor", yes: true, copy: true, all: true }),
		).toEqual(["-y", "skills", "add", "/s", "--global", "--agent", "claude-code,cursor", "-y", "--copy", "--all"]);
	});
});
