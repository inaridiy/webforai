import path from "node:path";
import { describe, expect, it } from "vitest";
import { pageRelativePath, planOutputFiles, resolveInside } from "./files";

describe("pageRelativePath", () => {
	it.each([
		["https://docs.example.com/", "index.md"],
		["https://docs.example.com", "index.md"],
		["https://docs.example.com/docs/", "docs/index.md"],
		["https://docs.example.com/docs/intro", "docs/intro.md"],
		["https://docs.example.com/docs/intro.html", "docs/intro.md"],
		["https://docs.example.com/a%20b/caf%C3%A9", "a-b/café.md"],
	])("%s → %s", (url, expected) => {
		expect(pageRelativePath(url)).toBe(expected);
	});

	it("prefixes the host for multi-origin output", () => {
		expect(pageRelativePath("https://www.example.com/post/1", { includeHost: true })).toBe("www.example.com/post/1.md");
		expect(pageRelativePath("http://localhost:8080/", { includeHost: true })).toBe("localhost-8080/index.md");
	});

	it("keeps query variants apart with a stable hash", () => {
		const first = pageRelativePath("https://x.example/list?page=1");
		const second = pageRelativePath("https://x.example/list?page=2");
		expect(first).toMatch(/^list_q-[0-9a-f]{8}\.md$/u);
		expect(first).not.toBe(second);
		expect(pageRelativePath("https://x.example/list?page=1")).toBe(first);
	});

	it("cannot be steered outside the output directory", () => {
		for (const url of [
			"https://x.example/%2e%2e/%2e%2e/etc/passwd",
			"https://x.example/..%2F..%2Fetc/passwd",
			"https://x.example/a/%2F%2Fabs",
			"https://x.example/C:%5Cwin",
		]) {
			const relative = pageRelativePath(url);
			expect(relative.startsWith("/")).toBe(false);
			expect(relative.split("/")).not.toContain("..");
			expect(() => resolveInside("/tmp/out", relative)).not.toThrow();
		}
	});

	it("bounds very long segments", () => {
		const relative = pageRelativePath(`https://x.example/${"a".repeat(300)}`);
		expect(relative.length).toBeLessThan(100);
	});
});

describe("planOutputFiles", () => {
	it("is deterministic whatever order results arrive in, with _N suffixes on collisions", () => {
		const urls = ["https://x.example/a.html", "https://x.example/a", "https://x.example/A", "https://x.example/"];
		const plan = planOutputFiles(urls);
		expect(planOutputFiles([...urls].reverse())).toEqual(plan);
		expect(plan.map((file) => file.relativePath)).toEqual(["index.md", "A.md", "a_1.md", "a_2.md"]);
	});
});

describe("resolveInside", () => {
	it("refuses paths that escape the root", () => {
		expect(() => resolveInside("/tmp/out", "../x.md")).toThrow(/outside/);
		expect(resolveInside("/tmp/out", "docs/a.md")).toBe(path.resolve("/tmp/out/docs/a.md"));
	});
});
