import { describe, expect, it } from "vitest";

import { stripScriptBodies } from "./parse-html";

describe("stripScriptBodies", () => {
	it("empties script and style bodies and keeps the elements and their attributes", () => {
		expect(
			stripScriptBodies(`<p>a</p><script src="x.js" defer>var big = 1;</script><STYLE media="print">p{}</STYLE>`),
		).toBe(`<p>a</p><script src="x.js" defer></script><STYLE media="print"></STYLE>`);
	});

	it("keeps the scripts conversion reads: JSON-LD, YouTube's player response, bot challenges", () => {
		const kept = [
			`<script type="application/ld+json">{"@type":"Article"}</script>`,
			"<script>var ytInitialPlayerResponse = {};</script>",
			"<script>window._cf_chl_opt = {};</script>",
		];
		for (const html of kept) {
			expect(stripScriptBodies(html)).toBe(html);
		}
	});

	it("reads quoted attribute values whole, even when they contain `>`", () => {
		const html = `<li><style data-mw='{"wt":"&lt;code>.md&lt;/code>"}'>.a{}</style><span>RFC</span></li>`;
		expect(stripScriptBodies(html)).toBe(
			`<li><style data-mw='{"wt":"&lt;code>.md&lt;/code>"}'></style><span>RFC</span></li>`,
		);
	});

	it("leaves comments and unclosed elements alone, as the HTML tokenizer reads them", () => {
		const commented = "<!-- <script> --><p>kept</p><script>x</script>";
		expect(stripScriptBodies(commented)).toBe("<!-- <script> --><p>kept</p><script></script>");
		expect(stripScriptBodies("<p>a</p><script>never closed")).toBe("<p>a</p><script>never closed");
	});

	it("stays linear on hostile input", () => {
		const started = performance.now();
		stripScriptBodies("<script a='".repeat(50_000));
		stripScriptBodies("<style>x".repeat(50_000));
		stripScriptBodies(`<script>${"</scrip".repeat(100_000)}</script>`.repeat(10));
		expect(performance.now() - started).toBeLessThan(1_000);
	});
});
