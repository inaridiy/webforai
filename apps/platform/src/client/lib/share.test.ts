import { describe, expect, it } from "vitest";
import { shareDestination, sharedUrl } from "./share";

const params = (init: Record<string, string>): URLSearchParams => new URLSearchParams(init);

describe("sharedUrl", () => {
	it("prefers the url field", () => {
		expect(sharedUrl(params({ url: "https://example.com/a", text: "see https://other.test/b" }))).toBe(
			"https://example.com/a",
		);
	});

	it("falls back to the first URL inside text, without trailing punctuation", () => {
		expect(sharedUrl(params({ title: "Article", text: "Read this (https://example.com/post?id=1)." }))).toBe(
			"https://example.com/post?id=1",
		);
		expect(sharedUrl(params({ text: "記事 https://example.jp/記事。" }))).toBe(
			`https://example.jp/${encodeURIComponent("記事")}`,
		);
	});

	it("ignores non-http URLs and an unusable url field", () => {
		expect(sharedUrl(params({ url: "javascript:alert(1)", text: "no link here" }))).toBeNull();
		expect(sharedUrl(params({ url: "ftp://example.com/file", text: "http://example.com/x" }))).toBe(
			"http://example.com/x",
		);
		expect(sharedUrl(params({}))).toBeNull();
	});
});

describe("shareDestination", () => {
	it("opens the playground when signed in and the landing demo otherwise", () => {
		expect(shareDestination("https://example.com/a?b=1", true)).toBe(
			"/playground?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1",
		);
		expect(shareDestination("https://example.com/", false)).toBe("/?url=https%3A%2F%2Fexample.com%2F");
	});
});
