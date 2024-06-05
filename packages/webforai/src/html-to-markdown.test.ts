import { distance } from "fastest-levenshtein";
import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./html-to-markdown";

const html = `
<h1>Hello, world!</h1>
<p>This is a paragraph.</p>
<a href="/example.html">Example</a>
<img src="/example.jpg" alt="Example" />
<ul>
  <li>Item 1</li>
  <li>Item 2</li>
</ul>
`;

const expected = `# Hello, world!

This is a paragraph.

[Example](/example.html)

![Example](/example.jpg)

* Item 1
* Item 2
`;

const baseUrlReplaced = `# Hello, world!

This is a paragraph.

[Example](https://example.com/example.html)
 
![Example](https://example.com/example.jpg)

* Item 1
* Item 2
`;

const linkAsText = `# Hello, world!

This is a paragraph.

Example

![Example](/example.jpg)

* Item 1
* Item 2
`;

const imageHidden = `# Hello, world!

This is a paragraph.

[Example](/example.html)

* Item 1
* Item 2
`;

const htmlTable = `
<table>
  <tr>
    <th>Header 1</th>
    <th>Header 2</th>
  </tr>
  <tr>
    <td>Cell 1</td>
    <td>Cell 2</td>
  </tr>
</table>
`;

const expectedTableMarkdown = `
| Header 1 | Header 2 |
| -------- | -------- |
| Cell 1   | Cell 2   |
`;

const expectedTableText = `Header 1  Header 2
Cell 1    Cell 2`;

describe("htmlToMarkdown", () => {
	it("should convert HTML to Markdown", () => {
		const markdown = htmlToMarkdown(html, { extractors: false });
		const d = distance(markdown, expected);
		expect(d).lte(2);
	});

	it("should convert HTML to Markdown with replaced base URL", () => {
		const markdown = htmlToMarkdown(html, { baseUrl: "https://example.com", extractors: false });
		const d = distance(markdown, baseUrlReplaced);
		expect(d).lte(2);
	});

	it("should convert HTML to Markdown with links as text", () => {
		const markdown = htmlToMarkdown(html, { linkAsText: true, extractors: false });
		const d = distance(markdown, linkAsText);
		expect(d).lte(2);
	});

	it("should convert HTML to Markdown with hidden images", () => {
		const markdown = htmlToMarkdown(html, { hideImage: true, extractors: false });
		const d = distance(markdown, imageHidden);
		expect(d).lte(2);
	});

	it("should convert HTML table to Markdown table", () => {
		const markdown = htmlToMarkdown(htmlTable, { extractors: false });
		const d = distance(markdown, expectedTableMarkdown);
		expect(d).lte(4);
	});

	it("should convert HTML table with table as text option", () => {
		const markdown = htmlToMarkdown(htmlTable, { tableAsText: true, extractors: false });
		const d = distance(markdown, expectedTableText);
		expect(d).lte(10); // Allow a higher distance due to the difference in formatting
	});
});
