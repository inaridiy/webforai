import { describe, expect, it } from "vitest";

import { htmlToMarkdown } from "../../html-to-markdown";

const comment = (id: string, indent: number, user: string, body: string): string =>
	`<tr class="athing comtr" id="${id}"><td><table><tr><td class="ind" indent="${indent}"><img src="s.gif" height="1" width="${
		indent * 40
	}"></td><td class="default"><div><span class="comhead"><a href="user?id=${user}" class="hnuser">${user}</a></span></div><br><div class="comment"><div class="commtext c00">${body}</div></div></td></tr></table></td></tr>`;

const page = `<html><body><center><table id="hnmain"><tr><td><table class="fatitem"><tr class="athing submission"><td class="title"><span class="titleline"><a href="https://example.com/post">A story</a></span></td></tr></table><table class="comment-tree">${comment(
	"1",
	0,
	"alice",
	"Top-level comment body.",
)}${comment("2", 1, "bob", "A reply to alice.")}${comment(
	"3",
	0,
	"carol",
	"Second top-level comment.",
)}</table></td></tr></table></center></body></html>`;

const convert = (): string =>
	htmlToMarkdown(page, { url: "https://news.ycombinator.com/item?id=1", baseUrl: "https://news.ycombinator.com/" });

describe("hackernews adapter", () => {
	it("keeps the body of top-level comments", () => {
		const markdown = convert();
		expect(markdown).toContain("**alice**");
		expect(markdown).toContain("Top-level comment body.");
		expect(markdown).toContain("Second top-level comment.");
	});

	it("quotes replies one level per indent", () => {
		expect(convert()).toMatch(/^> A reply to alice\.$/m);
	});
});
