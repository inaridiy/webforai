import type { Root } from "mdast";
import { describe, expect, it } from "vitest";
import { mdastToMarkdown } from "./mdast-to-markdown";

describe("mdastToMarkdown fidelity", () => {
	it("preserves literal asterisks and Markdown examples in code", () => {
		const source = "****\n[example](/sample)";
		expect(mdastToMarkdown({ type: "code", lang: "md", value: source }, { baseUrl: "https://site.test" })).toBe(
			`\`\`\`md\n${source}\n\`\`\`\n`,
		);
	});

	it("resolves titled links and reference definitions without mutating the input", () => {
		const tree: Root = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{ type: "link", url: "../a(b).html", title: "A title", children: [{ type: "text", value: "Page" }] },
						{ type: "image", url: "/image with spaces.png", title: "An image", alt: "Image" },
						{
							type: "linkReference",
							identifier: "ref",
							referenceType: "full",
							children: [{ type: "text", value: "Ref" }],
						},
					],
				},
				{ type: "definition", identifier: "ref", url: "?page=2", title: "Reference" },
			],
		};
		const original = structuredClone(tree);
		const markdown = mdastToMarkdown(tree, { baseUrl: "https://site.test/docs/start" });
		expect(markdown).toContain('[Page](https://site.test/a\\(b\\).html "A title")');
		expect(markdown).toContain('![Image](https://site.test/image%20with%20spaces.png "An image")');
		expect(markdown).toContain('[ref]: https://site.test/docs/start?page=2 "Reference"');
		expect(tree).toEqual(original);
	});
});
