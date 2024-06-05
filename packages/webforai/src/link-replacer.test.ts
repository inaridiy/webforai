import { describe, expect, it } from "vitest";
import { linkReplacer } from "./link-replacer";

const markdown = `# Hello, world!

This is a paragraph.

[Example](/example.html)

![Example](/example.jpg)

[Absolute Link](https://www.google.com)

[Link with hash](/page#hash)

[Link with query](/page?query=string)`;

const expected = `# Hello, world!

This is a paragraph.

[Example](https://example.com/example.html)

![Example](https://example.com/example.jpg)

[Absolute Link](https://www.google.com)

[Link with hash](https://example.com/page#hash)

[Link with query](https://example.com/page?query=string)`;

describe("linkReplacer", () => {
	it("should replace relative links", () => {
		const replaced = linkReplacer(markdown, "https://example.com");

		expect(replaced).toEqual(expected);
	});

	it("should not replace absolute links", () => {
		const replaced = linkReplacer("[Absolute Link](https://www.google.com)", "https://example.com");

		expect(replaced).toEqual("[Absolute Link](https://www.google.com)");
	});

	it("should handle links with hashes", () => {
		const replaced = linkReplacer("[Link with hash](/page#hash)", "https://example.com");

		expect(replaced).toEqual("[Link with hash](https://example.com/page#hash)");
	});

	it("should handle links with query parameters", () => {
		const replaced = linkReplacer("[Link with query](/page?query=string)", "https://example.com");

		expect(replaced).toEqual("[Link with query](https://example.com/page?query=string)");
	});
});
