import { distance } from "fastest-levenshtein";
import { fromHtml } from "hast-util-from-html";
import { describe, expect, it } from "vitest";
import type { ExtractParams } from "./extractors/types";
import { headingTitle, htmlToMarkdown, htmlToMarkdownWithMetadata } from "./html-to-markdown";

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

	it("uses a bold first row as the header of a table without <th>", () => {
		const markdown = htmlToMarkdown(
			"<table><tr><td><b>Name</b></td><td><b>Age</b></td></tr><tr><td>Ann</td><td>31</td></tr><tr><td>Bo</td><td>27</td></tr></table>",
			{ extractors: false },
		);
		expect(markdown.split("\n")[0]).toMatch(/^\| \*\*Name\*\* +\| \*\*Age\*\* +\|$/);
		expect(markdown).not.toMatch(/^\|\s+\|\s+\|$/m);
	});

	it("keeps the empty header when the first row of a table without <th> is data", () => {
		const markdown = htmlToMarkdown("<table><tr><td>Ann</td><td>31</td></tr><tr><td>Bo</td><td>27</td></tr></table>", {
			extractors: false,
		});
		expect(markdown).toMatch(/\| Ann +\| 31 +\|/);
		expect(markdown.split("\n")[0]).toMatch(/^\|\s+\|\s+\|$/);
	});

	it("drops table columns that are empty in every row", () => {
		const markdown = htmlToMarkdown(
			"<table><tr><th>A</th><th></th><th>B</th></tr><tr><td>1</td><td> </td><td>2</td></tr><tr><td>3</td><td></td><td>4</td></tr></table>",
			{ extractors: false },
		);
		expect(markdown.split("\n")[0]).toMatch(/^\| A +\| B +\|$/);
	});

	it("moves whitespace out of bold and italic so the delimiters still apply", () => {
		const markdown = htmlToMarkdown("<p><b>WIN55 </b>builds<em> fast</em> things<b> </b>here</p>", {
			extractors: false,
		});
		expect(markdown.trimEnd()).toBe("**WIN55** builds *fast* things here");
	});

	it("drops ligature icon-font names but keeps icon-classed containers", () => {
		const markdown = htmlToMarkdown(
			'<div><p><i class="material-icons">query_builder</i> 2026/09/04</p><label class="material-icons"><h3>Overview</h3></label></div>',
			{ extractors: false },
		);
		expect(markdown).not.toContain("query_builder");
		expect(markdown).toContain("2026/09/04");
		expect(markdown).toContain("### Overview");
	});

	it("splits paragraphs at <br><br> and drops breaks at paragraph edges", () => {
		const markdown = htmlToMarkdown("<p><br>First line<br>second line<br><br>Next part<br></p>", {
			extractors: false,
		});
		expect(markdown.trimEnd()).toBe("First line\\\nsecond line\n\nNext part");
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

describe("page title heading", () => {
	const page = (title: string, body: string, siteName?: string) =>
		`<html><head><title>${title}</title>${
			siteName ? `<meta property="og:site_name" content="${siteName}">` : ""
		}</head><body><article>${body}</article></body></html>`;
	const prose = `<p>${"Markdown is a lightweight markup language, here. ".repeat(20)}</p>`;

	it("drops the site name the title element appends", () => {
		const markdown = htmlToMarkdown(page("Markdown - Wikipedia", prose), {
			url: "https://en.wikipedia.org/wiki/Markdown",
		});
		expect(markdown.startsWith("# Markdown\n")).toBe(true);
	});

	it("keeps a hyphenated title that is not about the site", () => {
		const markdown = htmlToMarkdown(page("Rick Astley - Never Gonna Give You Up", prose, "YouTube"), {
			url: "https://www.youtube.com/watch?v=x",
		});
		expect(markdown.startsWith("# Rick Astley - Never Gonna Give You Up\n")).toBe(true);
	});

	it("keeps a leading product name unless it is the declared site name", () => {
		expect(headingTitle("Hono - Web framework built on Web Standards", undefined, "https://hono.dev/docs/")).toBe(
			"Hono - Web framework built on Web Standards",
		);
		expect(headingTitle("GitHub - inaridiy/webforai: HTML to Markdown", "GitHub", "https://github.com/x")).toBe(
			"inaridiy/webforai: HTML to Markdown",
		);
	});

	it("does not mistake a short title in the first sentence for the title", () => {
		expect(
			htmlToMarkdown(page("Markdown - Wikipedia", prose), { url: "https://en.wikipedia.org/wiki/Markdown" }),
		).toMatch(/^# Markdown\n/);
	});

	it("does not repeat a title the body shows as a lower-level heading", () => {
		const markdown = htmlToMarkdown(page("Release notes - ICS MEDIA", `<h2>Release notes</h2>${prose}`), {
			url: "https://ics.media/entry/1/",
		});
		expect(markdown.match(/Release notes/g)?.length).toBe(1);
	});

	it("uses a long product title rather than falling back to the first heading", () => {
		const long = `Amazon.co.jp: ${"Mini Drone for Kids, Compact, Indoor, ".repeat(5)}`;
		const markdown = htmlToMarkdown(page(long, `<h1>Product summary presents key product information</h1>${prose}`));
		expect(htmlToMarkdownWithMetadata(page(long, prose)).metadata.title).toContain("Mini Drone for Kids");
		expect(markdown).toContain("# Product summary");
	});
});

describe("lazy-loading placeholder images", () => {
	const convert = (html: string) => htmlToMarkdown(html, { extractors: false });

	it("drops an undescribed placeholder beside the real image", () => {
		const markdown = convert(
			'<a href="/a"><img src="https://cdn.example/web/grey-placeholder.png"><img src="https://cdn.example/photo.jpg" alt="Gaza"></a>',
		);
		expect(markdown).not.toContain("placeholder");
		expect(markdown).toContain("![Gaza](https://cdn.example/photo.jpg)");
	});

	it("keeps a described image even when its file is named placeholder", () => {
		expect(convert('<img src="/img/placeholder-ui.png" alt="The placeholder state of the input">')).toContain(
			"The placeholder state of the input",
		);
	});
});

describe("twoslash code blocks", () => {
	it("moves the language to the fence and writes errors as compiler comments", () => {
		const html = `<pre class="shiki light-plus twoslash lsp"><div class="language-id">ts</div><div class="code-container"><code><div class="line">greet(<data-err>42</data-err>);</div><span class="error"><span>Argument of type 'number' is not assignable.</span><span class="code">2345</span></span><span class="error-behind">Argument of type 'number' is not assignable.</span></code><a class="playground-link" href="https://www.typescriptlang.org/play">Try</a></div></pre>`;

		expect(htmlToMarkdown(html, { extractors: false })).toBe(
			"```ts\ngreet(42);\n// error TS2345: Argument of type 'number' is not assignable.\n```\n",
		);
	});
});

describe("review regressions (conversion)", () => {
	const convert = (html: string) => htmlToMarkdown(html, { extractors: false });

	it("keeps the code of a header-only code table", () => {
		expect(convert("<table><tr><th><pre><code>a\nb</code></pre></th></tr></table>")).toContain("a\nb");
	});

	it("keeps nested pre blocks on separate lines", () => {
		expect(convert("<pre><pre>inner</pre>outer</pre>")).toContain("inner\nouter");
	});

	it("does not strip a topic that merely starts with the host name", () => {
		expect(headingTitle("Guide - Docker Compose", undefined, "https://docs.docker.com/compose/")).toBe(
			"Guide - Docker Compose",
		);
		expect(headingTitle("Overview • Svelte Docs", undefined, "https://svelte.dev/docs")).toBe("Overview");
	});

	it("does not double line breaks for nested blocks in a cell", () => {
		expect(
			convert("<table><tr><th>A</th></tr><tr><td><p>Head</p><blockquote><p>q</p></blockquote></td></tr></table>"),
		).toContain("Head<br>q");
	});
});

describe("parsing limits", () => {
	it("converts pathologically deep markup instead of exhausting the stack", () => {
		const html = `${"<div>".repeat(3000)}<p>Deep text here.</p>${"</div>".repeat(3000)}`;
		expect(htmlToMarkdown(html, { extractors: false })).toContain("Deep text here.");
	});

	it("keeps paragraph boundaries of unwrapped deep content", () => {
		const html = `${"<div>".repeat(300)}<p>First.</p><p>Second.</p>${"</div>".repeat(300)}`;
		expect(htmlToMarkdown(html, { extractors: false })).toMatch(/First\.\s+Second\./);
	});
});
