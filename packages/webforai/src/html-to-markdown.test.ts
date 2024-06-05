import { distance } from "fastest-levenshtein";
import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./html-to-markdown";

const html = `
<h1>Hello, world!</h1>
<p>This is a paragraph.</p>
<ul>
  <li>Item 1</li>
  <li>Item 2</li>
</ul>
`;

const expected = `# Hello, world!

This is a paragraph.

* Item 1
* Item 2
`;

describe("htmlToMarkdown", () => {
	it("should convert HTML to Markdown", () => {
		const markdown = htmlToMarkdown(html, { extractors: false });
		const d = distance(markdown, expected);
		expect(d).lte(2);
	});
});
