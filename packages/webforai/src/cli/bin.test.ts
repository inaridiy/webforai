import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { tmpdir } from "node:os";
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
			expect(stderr).toContain(`manage billing, credits and the spend cap at ${platformUrl}/dashboard`);
			// Named once — by the client's message — not repeated as a separate hint line.
			expect(stderr.split(`${platformUrl}/dashboard`)).toHaveLength(2);
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	}, 30000);

	it("names the configured dashboard and the free allowance when no API key is set", async () => {
		const { code, stderr } = await runCli([
			"crawl",
			"https://example.com",
			"-o",
			"out",
			"--platform-url",
			"https://self.example",
		]);
		expect(code).toBe(2);
		expect(stderr).toContain("create one at https://self.example/dashboard; 1,000 free credits/month");
	}, 30000);
});

type Route = (request: IncomingMessage, body: string, origin: string) => { status?: number; json: unknown } | undefined;

/** A loopback fake of the platform's job API; records every request body. */
const withFakePlatform = async (
	route: Route,
	run: (origin: string, requests: { path: string; body: string }[]) => Promise<void>,
) => {
	const requests: { path: string; body: string }[] = [];
	let origin = "";
	const server = createServer((request: IncomingMessage, response: ServerResponse) => {
		let body = "";
		request.on("data", (chunk: Buffer) => {
			body += chunk.toString();
		});
		request.on("end", () => {
			requests.push({ path: `${request.method} ${request.url}`, body });
			const answer = route(request, body, origin) ?? {
				status: 404,
				json: { error: { code: "not_found", message: request.url } },
			};
			response.writeHead(answer.status ?? 200, { "content-type": "application/json" });
			response.end(JSON.stringify(answer.json));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("expected an ephemeral TCP port");
		}
		origin = `http://127.0.0.1:${address.port}`;
		await run(origin, requests);
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
};

const page = (url: string, markdown: string, metadata: Record<string, unknown> = {}) => ({
	status: "ok",
	url,
	engine: "fetch",
	markdown,
	metadata,
	credits: 1,
});

describe("webforai crawl / batch", () => {
	it("crawl submits the job, pages through results (incl. stored stubs) and writes files + llms.txt", async () => {
		const out = mkdtempSync(path.join(tmpdir(), "webforai-crawl-"));
		try {
			await withFakePlatform(
				(request, _body, origin) => {
					switch (`${request.method} ${request.url}`) {
						case "POST /v1/crawl":
							return { status: 202, json: { jobId: "job_1" } };
						case "GET /v1/jobs/job_1":
							return {
								json: {
									jobId: "job_1",
									type: "crawl",
									status: "completed",
									total: 4,
									completed: 3,
									failed: 1,
									credits: 3,
									expiresAt: "",
								},
							};
						case "GET /v1/jobs/job_1/results":
							return {
								json: {
									jobId: "job_1",
									status: "completed",
									results: [
										page("https://docs.example.com/", "# Example Docs\n\nWelcome.", {
											siteName: "Example Docs",
											description: "All about it.",
										}),
										{
											status: "error",
											url: "https://docs.example.com/private",
											engine: "auto",
											error: { code: "robots_disallowed", message: "disallowed" },
										},
									],
									cursor: "c2",
								},
							};
						case "GET /v1/jobs/job_1/results?cursor=c2":
							return {
								json: {
									jobId: "job_1",
									status: "completed",
									results: [
										page("https://docs.example.com/docs/intro", "# Intro", {
											title: "Intro",
											description: "Start here.",
										}),
										{
											status: "ok",
											url: "https://docs.example.com/docs/big",
											engine: "fetch",
											credits: 1,
											resultUrl: `${origin}/stored/big`,
										},
									],
								},
							};
						case "GET /stored/big":
							return { json: page("https://docs.example.com/docs/big", "# Big page", { title: "Big" }) };
						default:
							return undefined;
					}
				},
				async (origin, requests) => {
					const { code, stdout, stderr } = await runCli([
						"crawl",
						"https://docs.example.com/",
						"-o",
						out,
						"--max-depth",
						"1",
						"--limit",
						"10",
						"--include",
						"^/docs",
						"--include",
						"^/$",
						"--no-respect-robots",
						"--sitemap",
						"include",
						"--llms-txt",
						"--api-key",
						"wfa_test",
						"--platform-url",
						origin,
					]);
					expect(stderr).toContain("crawl job_1 completed: 3 page(s) written");
					expect(stderr).toContain("failed https://docs.example.com/private — robots_disallowed");
					expect(code).toBe(0);
					expect(stdout.trim().split("\n")).toEqual([
						path.join(out, "index.md"),
						path.join(out, "docs/big.md"),
						path.join(out, "docs/intro.md"),
					]);
					expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
						url: "https://docs.example.com/",
						maxDepth: 1,
						limit: 10,
						includePaths: ["^/docs", "^/$"],
						sitemap: "include",
						respectRobotsTxt: false,
						convert: { extractor: "auto" },
					});
				},
			);
			expect(readFileSync(path.join(out, "docs/big.md"), "utf-8")).toBe("# Big page\n");
			const llms = readFileSync(path.join(out, "llms.txt"), "utf-8");
			expect(llms.startsWith("# Example Docs\n\n> All about it.\n")).toBe(true);
			expect(llms).toContain(
				"## Docs\n\n- [Big](https://docs.example.com/docs/big)\n- [Intro](https://docs.example.com/docs/intro): Start here.",
			);
			expect(readFileSync(path.join(out, "llms-full.txt"), "utf-8")).toContain(
				"Source: https://docs.example.com/docs/intro\n\n# Intro",
			);
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	}, 30000);

	it("batch reads --file, writes host-prefixed files and prints a JSON envelope; retries 429", async () => {
		const out = mkdtempSync(path.join(tmpdir(), "webforai-batch-"));
		const list = path.join(out, "urls.txt");
		writeFileSync(list, "# urls\nhttps://a.example/post\nhttps://b.example/\n");
		let submits = 0;
		try {
			await withFakePlatform(
				(request) => {
					switch (`${request.method} ${request.url}`) {
						case "POST /v1/batch":
							submits++;
							return submits === 1
								? { status: 429, json: { error: { code: "rate_limited", message: "slow down", retryAfter: 1 } } }
								: { status: 202, json: { jobId: "job_b" } };
						case "GET /v1/jobs/job_b":
							return {
								json: {
									jobId: "job_b",
									type: "batch",
									status: "completed",
									total: 2,
									completed: 2,
									failed: 0,
									credits: 2,
									expiresAt: "",
								},
							};
						case "GET /v1/jobs/job_b/results":
							return {
								json: {
									jobId: "job_b",
									status: "completed",
									results: [page("https://b.example/", "# B"), page("https://a.example/post", "# A", { title: "A" })],
								},
							};
						default:
							return undefined;
					}
				},
				async (origin, requests) => {
					const { code, stdout, stderr } = await runCli([
						"batch",
						"--file",
						list,
						"-o",
						path.join(out, "pages"),
						"--json",
						"--api-key",
						"wfa_test",
						"--platform-url",
						origin,
					]);
					expect(stderr).toContain("rate limited; retrying in 1s");
					expect(code).toBe(0);
					const envelope = JSON.parse(stdout) as {
						jobId: string;
						credits: number;
						pages: { url: string; file: string }[];
					};
					expect(envelope).toMatchObject({ jobId: "job_b", credits: 2 });
					expect(envelope.pages.map((entry) => entry.file)).toEqual([
						path.join(out, "pages", "a.example/post.md"),
						path.join(out, "pages", "b.example/index.md"),
					]);
					expect(JSON.parse(requests.find((entry) => entry.path === "POST /v1/batch")?.body ?? "{}")).toMatchObject({
						urls: ["https://a.example/post", "https://b.example/"],
					});
				},
			);
			expect(readFileSync(path.join(out, "pages", "a.example", "post.md"), "utf-8")).toBe("# A\n");
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	}, 30000);

	it("exits 1 with the job error when the job failed", async () => {
		const out = mkdtempSync(path.join(tmpdir(), "webforai-failed-"));
		try {
			await withFakePlatform(
				(request) => {
					switch (`${request.method} ${request.url}`) {
						case "POST /v1/batch":
							return { status: 202, json: { jobId: "job_f" } };
						case "GET /v1/jobs/job_f":
							return {
								json: {
									jobId: "job_f",
									type: "batch",
									status: "failed",
									total: 1,
									completed: 0,
									failed: 1,
									credits: 0,
									expiresAt: "",
									error: "boom",
								},
							};
						case "GET /v1/jobs/job_f/results":
							return { json: { jobId: "job_f", status: "failed", results: [] } };
						default:
							return undefined;
					}
				},
				async (origin) => {
					const { code, stdout, stderr } = await runCli([
						"batch",
						"https://a.example/",
						"-o",
						out,
						"--api-key",
						"k",
						"--platform-url",
						origin,
					]);
					expect(code).toBe(1);
					expect(stdout).toBe("");
					expect(stderr).toContain("error: batch job job_f failed: boom");
				},
			);
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	}, 30000);
});
