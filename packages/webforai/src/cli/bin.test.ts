import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const PACKAGE_DIR = fileURLToPath(new URL("../..", import.meta.url));
const TSX = path.join(PACKAGE_DIR, "node_modules", ".bin", "tsx");
const BIN = path.join(PACKAGE_DIR, "src", "cli", "bin.ts");
const FIXTURE = path.join(PACKAGE_DIR, "src", "cli", "__fixtures__", "sample.html");

const runCli = async (args: string[]) => {
	try {
		const { stdout, stderr } = await execFileAsync(TSX, [BIN, ...args], { cwd: PACKAGE_DIR });
		return { stdout, stderr, code: 0 };
	} catch (error) {
		const failure = error as { stdout?: string; stderr?: string; code?: number };
		return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", code: failure.code ?? 1 };
	}
};

describe("webforai CLI binary", () => {
	it("converts a local HTML file to markdown on stdout, logs nothing there", async () => {
		const { stdout, code } = await runCli([FIXTURE]);
		expect(code).toBe(0);
		expect(stdout).toContain("# CLI Fixture Article");
		expect(stdout).toContain("relative link");
		expect(stdout).not.toContain("[webforai]");
	}, 30000);

	it("--json emits a parseable envelope with markdown and metadata", async () => {
		const { stdout, code } = await runCli([FIXTURE, "--json", "--frontmatter"]);
		expect(code).toBe(0);
		const envelope = JSON.parse(stdout) as { markdown: string; metadata: { title?: string }; loader: string };
		expect(envelope.loader).toBe("local");
		expect(envelope.markdown.startsWith("---\n")).toBe(true); // --frontmatter took effect
		expect(envelope.markdown).toContain("CLI Fixture Article");
		expect(envelope.metadata.title).toBe("CLI Fixture Article");
	}, 30000);

	it("skill prints the Agent Skill with frontmatter", async () => {
		const { stdout, code } = await runCli(["skill"]);
		expect(code).toBe(0);
		expect(stdout.startsWith("---\nname: webforai\n")).toBe(true);
	}, 30000);

	it("usage errors exit 2 with the message on stderr", async () => {
		const { code, stderr, stdout } = await runCli(["https://example.com", "--mode", "nope"]);
		expect(code).toBe(2);
		expect(stderr).toContain("default | ai");
		expect(stdout).toBe("");
	}, 30000);
});
