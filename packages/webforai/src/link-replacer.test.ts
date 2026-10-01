import { describe, expect, it } from "vitest";
import { linkReplacer } from "./link-replacer";

describe("linkReplacer", () => {
	it.each([
		["/example.html", "https://example.com/example.html"],
		["../example.jpg", "https://example.com/example.jpg"],
		["/page#hash", "https://example.com/page#hash"],
		["?query=string", "https://example.com/docs/start?query=string"],
		["//cdn.test/image.jpg", "https://cdn.test/image.jpg"],
		["https://www.google.com", "https://www.google.com"],
		["mailto:user@example.com", "mailto:user@example.com"],
		["#section", "#section"],
	])("resolves %s to %s", (url, expected) => {
		const node = { type: "image" as const, url, alt: "Example" };
		expect(linkReplacer(node, "https://example.com/docs/start").url).toBe(expected);
		expect(node.url).toBe(url);
	});

	it("keeps relative URLs when the base cannot be parsed", () => {
		const node = { type: "image" as const, url: "/image.jpg", alt: "Example" };
		expect(linkReplacer(node, "invalid")).toEqual(node);
	});
});
