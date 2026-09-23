import { execFile } from "node:child_process";
import { createServer } from "node:http";
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
		const { stdout, stderr } = await execFileAsync(TSX, [BIN, ...args], { cwd: PACKAGE_DIR, timeout: 25000 });
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

	it("reports platform error codes and retry hints on stderr through the real HTTP client", async () => {
		const server = createServer((_request, response) => {
			response.writeHead(429, { "content-type": "application/json", "retry-after": "7" });
			response.end(JSON.stringify({ error: { code: "rate_limited", message: "slow down" } }));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") {
				throw new Error("expected an ephemeral TCP port");
			}
			const { code, stdout, stderr } = await runCli([
				"https://example.com",
				"--engine",
				"fetch",
				"--api-key",
				"wfa_test",
				"--platform-url",
				`http://127.0.0.1:${address.port}`,
				"--json",
			]);
			expect(code).toBe(1);
			expect(stdout).toBe("");
			expect(stderr).toContain("rate_limited: slow down (retryAfter: 7s)");
			expect(stderr).not.toContain("hint:");
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	}, 30000);

	it("points auth and credit failures at the configured platform's dashboard", async () => {
		const server = createServer((_request, response) => {
			response.writeHead(402, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: { code: "payment_required", message: "out of credits" } }));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") {
				throw new Error("expected an ephemeral TCP port");
			}
			const platformUrl = `http://127.0.0.1:${address.port}`;
			const { code, stderr } = await runCli([
				"https://example.com",
				"--engine",
				"fetch",
				"--api-key",
				"wfa_test",
				"--platform-url",
				`${platformUrl}/`,
			]);
			expect(code).toBe(1);
			expect(stderr).toContain("payment_required: out of credits");
			expect(stderr).toContain(`hint: manage API keys and credits at ${platformUrl}/dashboard`);
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	}, 30000);
});
