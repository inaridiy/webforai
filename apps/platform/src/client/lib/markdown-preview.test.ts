import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdownPreview, safeHref } from "./markdown-preview";

describe("parseMarkdownPreview", () => {
	it("splits frontmatter, headings, paragraphs and fenced code", () => {
		const doc = parseMarkdownPreview(
			[
				"---",
				"title: Getting Started",
				"url: https://webforai.dev",
				"---",
				"",
				"# Hello",
				"",
				"First line",
				"second line",
				"",
				"```bash",
				"npm i webforai",
				"```",
			].join("\n"),
		);
		expect(doc.frontmatter).toEqual([
			{ key: "title", value: "Getting Started" },
			{ key: "url", value: "https://webforai.dev" },
		]);
		expect(doc.blocks).toEqual([
			{ kind: "heading", depth: 1, children: [{ kind: "text", text: "Hello" }] },
			{ kind: "paragraph", children: [{ kind: "text", text: "First line second line" }] },
			{ kind: "code", lang: "bash", text: "npm i webforai" },
		]);
	});

	it("treats a leading --- without a closing fence as content, not frontmatter", () => {
		const doc = parseMarkdownPreview("---\nnot frontmatter");
		expect(doc.frontmatter).toEqual([]);
		expect(doc.blocks[0]).toEqual({ kind: "hr" });
	});

	it("parses ordered and unordered lists and quotes", () => {
		const doc = parseMarkdownPreview("- one\n- two\n\n1. first\n2. second\n\n> quoted text");
		expect(doc.blocks).toEqual([
			{
				kind: "list",
				ordered: false,
				items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]],
			},
			{
				kind: "list",
				ordered: true,
				items: [[{ kind: "text", text: "first" }], [{ kind: "text", text: "second" }]],
			},
			{ kind: "quote", children: [{ kind: "text", text: "quoted text" }] },
		]);
	});
});

describe("parseInline", () => {
	it("parses code, strong, em and links with surrounding text", () => {
		expect(parseInline("use `npm` with **webforai** via [docs](https://webforai.dev) now")).toEqual([
			{ kind: "text", text: "use " },
			{ kind: "code", text: "npm" },
			{ kind: "text", text: " with " },
			{ kind: "strong", children: [{ kind: "text", text: "webforai" }] },
			{ kind: "text", text: " via " },
			{ kind: "link", href: "https://webforai.dev", children: [{ kind: "text", text: "docs" }] },
			{ kind: "text", text: " now" },
		]);
	});

	it("renders images as links labelled by their alt text without loading them", () => {
		expect(parseInline("![logo](https://example.com/a.png)")).toEqual([
			{ kind: "link", href: "https://example.com/a.png", children: [{ kind: "text", text: "logo" }] },
		]);
	});

	it("prefers strong over em at the same position", () => {
		expect(parseInline("**bold**")).toEqual([{ kind: "strong", children: [{ kind: "text", text: "bold" }] }]);
	});
});

describe("safeHref", () => {
	it("keeps http(s) and mailto and drops everything else", () => {
		expect(safeHref("https://webforai.dev")).toBe("https://webforai.dev");
		expect(safeHref("mailto:hi@example.com")).toBe("mailto:hi@example.com");
		expect(safeHref("javascript:alert(1)")).toBeUndefined();
		expect(safeHref("data:text/html,x")).toBeUndefined();
		expect(safeHref("/relative")).toBeUndefined();
	});
});
