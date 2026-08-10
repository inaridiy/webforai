import { fromHtml } from "hast-util-from-html";
import { describe, expect, it } from "vitest";

import { htmlToMarkdown, htmlToMarkdownWithMetadata } from "../html-to-markdown";
import { extractMetadata, readJsonLd, toFrontmatter } from "./index";

const parse = (html: string) => fromHtml(html, { fragment: true });

describe("extractMetadata", () => {
	it("reads Open Graph tags", () => {
		const metadata = extractMetadata(
			parse(`<head>
				<meta property="og:title" content="OG Title">
				<meta property="og:description" content="OG description">
				<meta property="og:site_name" content="Example Site">
				<meta property="og:type" content="article">
			</head>`),
		);

		expect(metadata.title).toBe("OG Title");
		expect(metadata.description).toBe("OG description");
		expect(metadata.siteName).toBe("Example Site");
		expect(metadata.type).toBe("article");
	});

	it("prefers the Open Graph title over a JSON-LD headline", () => {
		// Several publishers, Wikipedia among them, put a descriptive sentence in `headline`.
		// Blinded evaluation caught this reading as the page title.
		const metadata = extractMetadata(
			parse(`<head>
				<meta property="og:title" content="Social Title">
				<script type="application/ld+json">
					{"@type":"NewsArticle","headline":"Structured Headline"}
				</script>
			</head>`),
		);

		expect(metadata.title).toBe("Social Title");
	});

	it("falls back to the JSON-LD headline when there is no Open Graph title", () => {
		const metadata = extractMetadata(
			parse(`<script type="application/ld+json">{"@type":"NewsArticle","headline":"Structured Headline"}</script>`),
		);

		expect(metadata.title).toBe("Structured Headline");
	});

	it("rejects a sentence-length value as a title", () => {
		const description = `${"A lightweight markup language with plain-text formatting syntax. ".repeat(4)}`;
		const metadata = extractMetadata(
			parse(`<head>
				<title>Real Title</title>
				<script type="application/ld+json">{"@type":"Article","headline":${JSON.stringify(description)}}</script>
			</head>`),
		);

		expect(metadata.title).toBe("Real Title");
	});

	it("reads an author expressed as a nested Person", () => {
		const metadata = extractMetadata(
			parse(`<script type="application/ld+json">
				{"@type":"Article","author":{"@type":"Person","name":"Ada Lovelace"}}
			</script>`),
		);

		expect(metadata.author).toBe("Ada Lovelace");
	});

	it("reads an author from an array of contributors", () => {
		const metadata = extractMetadata(
			parse(`<script type="application/ld+json">
				{"@type":"Article","author":[{"name":"First Author"},{"name":"Second Author"}]}
			</script>`),
		);

		expect(metadata.author).toBe("First Author");
	});

	it("unwraps entries nested under @graph", () => {
		const metadata = extractMetadata(
			parse(`<script type="application/ld+json">
				{"@graph":[{"@type":"WebSite","name":"Site"},{"@type":"BlogPosting","headline":"Graph Headline"}]}
			</script>`),
		);

		expect(metadata.title).toBe("Graph Headline");
	});

	it("falls back to the document title, then to the first heading", () => {
		expect(extractMetadata(parse("<head><title>Doc Title</title></head>")).title).toBe("Doc Title");
		expect(extractMetadata(parse("<body><h1>Heading Title</h1></body>")).title).toBe("Heading Title");
	});

	it("reads the canonical URL from a link element", () => {
		const metadata = extractMetadata(parse(`<link rel="canonical" href="https://example.com/post">`));
		expect(metadata.canonicalUrl).toBe("https://example.com/post");
	});

	it("reads the document language from a parsed document", () => {
		// Parsed as a document, not a fragment: fragment parsing discards `<html>` along with the
		// `lang` it carries, which is why the string entry point reads it from the source instead.
		const document = fromHtml(`<html lang="ja"><body>x</body></html>`);
		expect(extractMetadata(document).lang).toBe("ja");
	});

	it("reads a language declared on a nested element", () => {
		expect(extractMetadata(parse(`<div lang="fr"><p>bonjour</p></div>`)).lang).toBe("fr");
	});

	it("collapses whitespace in extracted values", () => {
		expect(extractMetadata(parse("<title>  Spaced   Title  </title>")).title).toBe("Spaced Title");
	});

	it("survives malformed JSON-LD", () => {
		const metadata = extractMetadata(
			parse(`<head>
				<title>Fallback</title>
				<script type="application/ld+json">{ not valid json </script>
			</head>`),
		);

		expect(metadata.title).toBe("Fallback");
	});

	it("returns an empty object for a page with no metadata", () => {
		expect(extractMetadata(parse("<div>text</div>")).title).toBeUndefined();
	});
});

describe("readJsonLd", () => {
	it("returns every block on the page", () => {
		const entries = readJsonLd(
			parse(`
				<script type="application/ld+json">{"@type":"A"}</script>
				<script type="application/ld+json">{"@type":"B"}</script>
			`),
		);

		expect(entries).toHaveLength(2);
	});

	it("ignores scripts that are not JSON-LD", () => {
		expect(readJsonLd(parse(`<script type="text/javascript">var x = {a:1}</script>`))).toHaveLength(0);
	});
});

describe("toFrontmatter", () => {
	it("renders known fields as YAML", () => {
		const frontmatter = toFrontmatter({ title: "T", author: "A" });
		expect(frontmatter).toBe('---\ntitle: "T"\nauthor: "A"\n---\n\n');
	});

	it("returns an empty string when nothing is known", () => {
		expect(toFrontmatter({})).toBe("");
	});

	it("escapes quotes and backslashes", () => {
		expect(toFrontmatter({ title: 'He said "hi"\\' })).toContain('title: "He said \\"hi\\"\\\\"');
	});
});

describe("htmlToMarkdown with metadata", () => {
	const html = `<html lang="en"><head>
		<meta property="og:title" content="Post Title">
		<meta name="author" content="Ada">
	</head><body><article><h1>Post Title</h1><p>${"Body text. ".repeat(40)}</p></article></body></html>`;

	it("prepends front matter when asked", () => {
		const markdown = htmlToMarkdown(html, { frontmatter: true });
		expect(markdown.startsWith("---\n")).toBe(true);
		expect(markdown).toContain('title: "Post Title"');
		expect(markdown).toContain('author: "Ada"');
	});

	it("emits no front matter by default", () => {
		expect(htmlToMarkdown(html).startsWith("---")).toBe(false);
	});

	it("returns metadata alongside the markdown", () => {
		const { markdown, metadata } = htmlToMarkdownWithMetadata(html);
		expect(metadata.title).toBe("Post Title");
		expect(metadata.lang).toBe("en");
		expect(markdown).toContain("Body text.");
	});

	it("omits the front-matter block for a page with no metadata", () => {
		const bare = `<body><article><p>${"Just text. ".repeat(40)}</p></article></body>`;
		expect(htmlToMarkdown(bare, { frontmatter: true }).startsWith("---")).toBe(false);
	});
});
