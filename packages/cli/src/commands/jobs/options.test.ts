import { describe, expect, it } from "vitest";
import { API_KEY_ENV, PLATFORM_URL_ENV } from "../../constants";
import { UsageError } from "../webforai/options";
import { parseUrlList, resolveJobOptions } from "./options";

const ENV = { [API_KEY_ENV]: "wfa_env" };

describe("resolveJobOptions", () => {
	it("resolves a crawl with numeric bounds and repeatable patterns", () => {
		const job = resolveJobOptions(
			"crawl",
			["https://docs.example.com/"],
			{
				output: "out",
				sitemap: "include",
				maxDepth: "3",
				limit: "120",
				include: ["^/docs", "^/guide"],
				respectRobots: false,
				llmsTxt: true,
			},
			ENV,
		);
		expect(job).toMatchObject({
			kind: "crawl",
			urls: ["https://docs.example.com/"],
			outputDir: "out",
			maxDepth: 3,
			limit: 120,
			sitemap: "include",
			includePaths: ["^/docs", "^/guide"],
			respectRobotsTxt: false,
			llmsTxt: true,
			apiKey: "wfa_env",
			timeoutMs: 1_800_000,
		});
	});

	it("leaves robots.txt to the server default unless a flag says otherwise", () => {
		expect(resolveJobOptions("crawl", ["https://x.example"], { output: "o" }, ENV).respectRobotsTxt).toBeUndefined();
	});

	it.each([
		[{ maxDepth: "6" }, /max-depth/],
		[{ limit: "0" }, /limit/],
		[{ limit: "1.5" }, /limit/],
		[{ include: ["("] }, /include/],
		[{ engine: "warp" }, /engine/],
		[{ region: "us" }, /region/],
		[{ sitemap: "all" }, /skip \| include \| only/],
		[{ timeout: "never" }, /timeout/],
	])("rejects %o", (flags, message) => {
		expect(() => resolveJobOptions("crawl", ["https://x.example"], { output: "o", ...flags }, ENV)).toThrow(message);
	});

	it("needs exactly one http(s) seed for crawl, and an output directory", () => {
		expect(() => resolveJobOptions("crawl", [], { output: "o" }, ENV)).toThrow(/exactly one/);
		expect(() => resolveJobOptions("crawl", ["ftp://x.example"], { output: "o" }, ENV)).toThrow(/http\(s\)/);
		expect(() => resolveJobOptions("crawl", ["https://x.example"], {}, ENV)).toThrow(/--output/);
	});

	it("merges batch URLs from arguments and --file, de-duplicated in order", () => {
		const job = resolveJobOptions(
			"batch",
			["https://a.example/"],
			{ output: "o", file: "urls.txt" },
			ENV,
			() => "# list\nhttps://b.example/\n\nhttps://a.example/\n",
		);
		expect(job.urls).toEqual(["https://a.example/", "https://b.example/"]);
	});

	it("caps batches at 100 URLs and reports unreadable files as usage errors", () => {
		const many = Array.from({ length: 101 }, (_, index) => `https://x.example/${index}`);
		expect(() => resolveJobOptions("batch", many, { output: "o" }, ENV)).toThrow(/at most 100/);
		expect(() =>
			resolveJobOptions("batch", [], { output: "o", file: "missing.txt" }, ENV, () => {
				throw new Error("ENOENT");
			}),
		).toThrow(UsageError);
	});

	it("names the configured dashboard and the free allowance when the key is missing", () => {
		expect(() =>
			resolveJobOptions(
				"batch",
				["https://x.example"],
				{ output: "o" },
				{ [PLATFORM_URL_ENV]: "https://self.example/" },
			),
		).toThrow("create one at https://self.example/dashboard; 1,000 free credits/month");
	});
});

describe("parseUrlList", () => {
	it("trims, skips blanks and comments, tolerates CRLF", () => {
		expect(parseUrlList(" https://a\r\n#x\r\n\r\nhttps://b ")).toEqual(["https://a", "https://b"]);
	});
});
