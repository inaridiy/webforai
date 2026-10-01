import { distance } from "fastest-levenshtein";
import { fromHtml } from "hast-util-from-html";
import { describe, expect, it } from "vitest";
import type { ExtractParams } from "./extractors/types";
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

- Item 1
- Item 2
`;

const imageHidden = `# Hello, world!

This is a paragraph.

[Example](/example.html)

- Item 1
- Item 2
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
	it("preserves code indentation and reads its explicit language", () => {
		const markdown = htmlToMarkdown('<pre><code class="language-c++">    first\n      second\n</code></pre>', {
			extractors: false,
		});
		expect(markdown).toBe("```c++\n    first\n      second\n```\n");
	});

	it("preserves indentation and language in a decorated code block", () => {
		const markdown = htmlToMarkdown(
			'<div class="code-block"><span>Copy</span><pre><code class="language-c++">    first\n      second\n</code></pre></div>',
			{ extractors: false },
		);
		expect(markdown).toBe("```c++\n    first\n      second\n```\n");
	});

	it("reads the language from data-language (Shiki / rehype-pretty-code)", () => {
		const markdown = htmlToMarkdown(
			'<figure data-rehype-pretty-code-figure=""><pre tabindex="0" data-language="tsx" data-theme="github-dark"><code data-language="tsx" style="display: grid;"><span data-line=""><span style="color:#F97583">import</span> x</span></code></pre></figure>',
			{ extractors: false },
		);
		expect(markdown).toBe("```tsx\nimport x\n```\n");
		expect(htmlToMarkdown('<pre data-lang="go"><code>x := 1</code></pre>', { extractors: false })).toBe(
			"```go\nx := 1\n```\n",
		);
	});

	it("keeps every example in a code tab group", () => {
		const markdown = htmlToMarkdown(
			'<div class="codegroup"><pre><code>first example</code></pre><pre><code>second example</code></pre></div>',
			{ extractors: false },
		);
		expect(markdown).toContain("first example");
		expect(markdown).toContain("second example");
	});

	it.each([false, ({ hast }: ExtractParams) => hast] as const)(
		"does not mutate caller HAST during normalization with extractor %s",
		(extractors) => {
			const tree = fromHtml('<div role="heading" aria-level="3">Title</div><img data-src="/real.png" alt="Photo">', {
				fragment: true,
			});
			const original = structuredClone(tree);
			const markdown = htmlToMarkdown(tree, { extractors });
			expect(markdown).toContain("### Title");
			expect(markdown).toContain("![Photo](/real.png)");
			expect(tree).toEqual(original);
		},
	);
	it("should convert HTML to Markdown", () => {
		const markdown = htmlToMarkdown(html, { extractors: false });
		const d = distance(markdown, expected);
		expect(d).lte(5);
	});

	it("should convert HTML to Markdown with replaced base URL", () => {
		const markdown = htmlToMarkdown(html, { baseUrl: "https://example.com", extractors: false });
		const d = distance(markdown, baseUrlReplaced);
		expect(d).lte(5);
	});

	it("should convert HTML to Markdown with links as text", () => {
		const markdown = htmlToMarkdown(html, { linkAsText: true, extractors: false });
		const d = distance(markdown, linkAsText);
		expect(d).lte(5);
	});

	it("should convert HTML to Markdown with hidden images", () => {
		const markdown = htmlToMarkdown(html, { hideImage: true, extractors: false });
		const d = distance(markdown, imageHidden);
		expect(d).lte(5);
	});

	it("should convert HTML table to Markdown table", () => {
		const markdown = htmlToMarkdown(htmlTable, { extractors: false });
		const d = distance(markdown, expectedTableMarkdown);
		expect(d).lte(5);
	});

	it("should convert HTML table with table as text option", () => {
		const markdown = htmlToMarkdown(htmlTable, { tableAsText: true, extractors: false });
		const d = distance(markdown, expectedTableText);
		expect(d).lte(10); // Allow a higher distance due to the difference in formatting
	});
});

// Conversion quality on real pages is measured by the recorded-corpus suite in `evals/`
// (see evals/src/corpus.test.ts). The old "Converting for good" test here compared two live
// sites by edit distance, which drifted red whenever either site shipped a redesign.

describe("tables with block content", () => {
	const convert = (html: string) => htmlToMarkdown(html, { extractors: false });

	it("keeps each row on one line when cells hold lists and paragraphs", () => {
		const markdown = convert(
			"<table><tr><th>Name</th><th>Family</th></tr><tr><td><p>Takuya</p></td><td><ul><li>Kōki</li><li>Shunsaku</li></ul></td></tr></table>",
		);

		expect(markdown).toContain("| Takuya | - Kōki<br>- Shunsaku |");
	});

	it("separates line breaks inside a cell instead of escaping them", () => {
		const markdown = convert("<table><tr><th>Release</th></tr><tr><td>1.0.1<br>December 17, 2004</td></tr></table>");

		expect(markdown).toContain("1.0.1<br>December 17, 2004");
		expect(markdown).not.toContain("&#xA;");
	});

	it("lays out a table of code samples as labelled blocks", () => {
		const markdown = convert(
			'<table><tr><th>Interface</th><th>Type</th></tr><tr><td><pre><code class="language-ts">interface A {\n  x: 1\n}</code></pre></td><td><pre><code class="language-ts">type A = {\n  x: 1\n}</code></pre></td></tr></table>',
		);

		expect(markdown).toContain("**Interface**\n\n```ts\ninterface A {\n  x: 1\n}\n```");
		expect(markdown).toContain("**Type**\n\n```ts\ntype A = {");
		expect(markdown).not.toContain("| ");
	});

	it("leaves ordinary tables untouched", () => {
		const markdown = convert("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td><code>x</code></td></tr></table>");
		expect(markdown).toContain("| 1 | `x` |");
	});
});

describe("display math written inside a sentence", () => {
	it("puts the formula on its own block between the sentence halves", () => {
		const markdown = htmlToMarkdown(
			'<p>is the equality <math display="block" alttext="{\\displaystyle e^{i\\pi }+1=0}"><mi>e</mi></math> where</p>',
			{ extractors: false },
		);

		expect(markdown).toBe("is the equality\n\n$$\ne^{i\\pi }+1=0\n$$\n\nwhere\n");
	});
});
