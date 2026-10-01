import type { Root, RootContent } from "mdast";
import { describe, expect, it, vi } from "vitest";
import { mdastSplitter } from "./md-splitter";

const section = (title: string): RootContent[] => [
	{ type: "heading", depth: 1, children: [{ type: "text", value: title }] },
	{ type: "heading", depth: 2, children: [{ type: "text", value: "One" }] },
	{ type: "paragraph", children: [{ type: "text", value: "x".repeat(20) }] },
	{ type: "heading", depth: 2, children: [{ type: "text", value: "Two" }] },
	{ type: "paragraph", children: [{ type: "text", value: "y".repeat(20) }] },
];

describe("mdastSplitter", () => {
	it("uses the same heading priorities for independent sections", async () => {
		const tree: Root = { type: "root", children: [...section("A"), ...section("B")] };
		const chunks = await mdastSplitter(tree, async (markdown) => markdown.length <= 45);
		expect(chunks.map((nodes) => nodes.length)).toEqual([1, 2, 2, 1, 2, 2]);
		expect(chunks.flat()).toEqual(tree.children);
	});

	it("does not invoke the checker when already aborted", async () => {
		const controller = new AbortController();
		controller.abort(new Error("Stopped"));
		const checker = vi.fn(async () => false);
		await expect(
			mdastSplitter({ type: "root", children: section("A") }, checker, { signal: controller.signal }),
		).rejects.toThrow("Stopped");
		expect(checker).not.toHaveBeenCalled();
	});

	it("aborts while a checker is still pending", async () => {
		const controller = new AbortController();
		const checker = vi.fn(() => new Promise<boolean>(() => {}));
		const result = mdastSplitter({ type: "root", children: section("A") }, checker, { signal: controller.signal });
		controller.abort(new Error("Stopped"));
		await expect(result).rejects.toThrow("Stopped");
		expect(checker).toHaveBeenCalledTimes(1);
	}, 500);
});
