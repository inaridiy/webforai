import { describe, expect, it } from "vitest";

import { htmlToMarkdown } from "../html-to-markdown";
import { bestFromSrcset } from "./index";

/** Conversions in this file exercise markup handling, so extraction is switched off. */
const convert = (html: string): string => htmlToMarkdown(html, { extractors: false });

describe("lazily-loaded images", () => {
	it("recovers the URL from data-src when src is absent", () => {
		expect(convert("<img data-src='/real.png' alt='L'>")).toContain("![L](/real.png)");
	});

	it("recovers the URL when src holds an inline placeholder", () => {
		const html = "<img src='data:image/gif;base64,R0lGOD' data-src='/real.png' alt='L'>";
		expect(convert(html)).toContain("![L](/real.png)");
	});

	it("keeps a real src rather than overriding it", () => {
		expect(convert("<img src='/actual.png' data-src='/other.png' alt='A'>")).toContain("![A](/actual.png)");
	});

	it("falls back to the largest srcset candidate", () => {
		expect(convert("<img srcset='/small.png 320w, /large.png 1280w' alt='S'>")).toContain("![S](/large.png)");
	});

	it("no longer emits an empty image URL", () => {
		expect(convert("<img data-src='/real.png' alt='L'>")).not.toContain("![L]()");
	});
});

describe("bestFromSrcset", () => {
	it("prefers the widest width descriptor", () => {
		expect(bestFromSrcset("/a.png 320w, /b.png 1280w, /c.png 640w")).toBe("/b.png");
	});

	it("prefers the highest density descriptor", () => {
		expect(bestFromSrcset("/a.png 1x, /b.png 3x, /c.png 2x")).toBe("/b.png");
	});

	it("handles a bare URL with no descriptor", () => {
		expect(bestFromSrcset("/only.png")).toBe("/only.png");
	});

	it("returns undefined for an empty srcset", () => {
		expect(bestFromSrcset("")).toBeUndefined();
	});
});

describe("rendered maths", () => {
	const katex = `<span class="katex"><span class="katex-mathml"><math><mi>E</mi></math></span><span class="katex-html" aria-hidden="true">E</span></span>`;

	it("emits a KaTeX expression once rather than twice", () => {
		expect(convert(katex).trim()).toBe("$E$");
	});

	it("keeps a MathJax expression from being duplicated", () => {
		const mathjax =
			"<mjx-container><mjx-math>E</mjx-math><mjx-assistive-mml><math><mi>E</mi></math></mjx-assistive-mml></mjx-container>";
		expect(convert(mathjax).trim()).toBe("$E$");
	});

	it.each([
		"<mjx-container><mjx-math>E</mjx-math></mjx-container>",
		"<mjx-container><mjx-math>E</mjx-math><mjx-assistive-mml></mjx-assistive-mml></mjx-container>",
		'<span class="katex"><span class="katex-mathml"></span><span class="katex-html">E</span></span>',
	])("preserves a sole rendered formula when MathML is absent: %s", (html) => {
		expect(convert(html).trim()).toBe("E");
	});

	it("preserves a MediaWiki formula image when there is no MathML alternative", () => {
		const html =
			'<span class="mwe-math-element"><img class="mwe-math-fallback-image-inline" src="/formula.png" alt="E"></span>';
		expect(convert(html)).toContain("![E](/formula.png)");
	});
});

describe("ARIA headings", () => {
	it("promotes role=heading with an explicit level", () => {
		expect(convert("<div role='heading' aria-level='2'>Pseudo</div>").trim()).toBe("## Pseudo");
	});

	it("defaults to level 2 when aria-level is missing", () => {
		expect(convert("<div role='heading'>Pseudo</div>").trim()).toBe("## Pseudo");
	});

	it("clamps out-of-range levels to a valid heading depth", () => {
		expect(convert("<div role='heading' aria-level='9'>Deep</div>").trim()).toBe("###### Deep");
	});

	it("leaves real heading elements alone", () => {
		expect(convert("<h3 role='heading' aria-level='1'>Real</h3>").trim()).toBe("### Real");
	});
});

describe("superscript and subscript", () => {
	it("keeps a superscript distinguishable from the surrounding text", () => {
		expect(convert("<p>x<sup>2</sup></p>").trim()).toBe("x<sup>2</sup>");
	});

	it("keeps a subscript distinguishable", () => {
		expect(convert("<p>H<sub>2</sub>O</p>").trim()).toBe("H<sub>2</sub>O");
	});

	it("no longer flattens an exponent into the text", () => {
		expect(convert("<p>x<sup>2</sup></p>").trim()).not.toBe("x2");
	});

	it("falls back to plain text for long content", () => {
		const long = "a".repeat(40);
		expect(convert(`<p>x<sup>${long}</sup></p>`).trim()).toBe(`x${long}`);
	});
});

describe("definition lists", () => {
	it("pairs each term with its definition", () => {
		const markdown = convert("<dl><dt>Term</dt><dd>Definition</dd></dl>");
		expect(markdown).toContain("**Term**");
		expect(markdown).toContain("Definition");
	});

	it("groups consecutive terms that share one definition", () => {
		const markdown = convert("<dl><dt>A</dt><dt>B</dt><dd>Shared</dd></dl>");
		expect(markdown).toContain("**A, B**");
	});

	it("keeps multiple definitions under one term", () => {
		const markdown = convert("<dl><dt>T</dt><dd>One</dd><dd>Two</dd></dl>");
		expect(markdown).toContain("One");
		expect(markdown).toContain("Two");
	});

	it("looks through the <div> wrappers HTML allows around each group", () => {
		// Regression: a legal page built this way (one div per row) converted to nothing.
		const markdown = convert(
			'<dl><div class="row"><dt>販売事業者</dt><dd>山田太郎</dd></div><div><dt>Email</dt><dd><a href="mailto:a@example.com">a@example.com</a></dd></div></dl>',
		);
		expect(markdown).toContain("**販売事業者**");
		expect(markdown).toContain("山田太郎");
		expect(markdown).toContain("**Email**");
		expect(markdown.indexOf("山田太郎")).toBeLessThan(markdown.indexOf("**Email**"));
	});

	it("keeps the content of a <dl> that has no terms or definitions", () => {
		expect(convert("<dl><p>Loose paragraph</p></dl>")).toContain("Loose paragraph");
	});

	it("survives main-content extraction on a page that is mostly a <div>-grouped <dl>", () => {
		const rows = ["販売事業者", "所在地", "電話番号", "支払方法", "返品・キャンセル"]
			.map(
				(term) =>
					`<div><dt>${term}</dt><dd>${term}についての説明文です。請求があった場合、遅滞なく開示いたします。</dd></div>`,
			)
			.join("");
		const markdown = htmlToMarkdown(
			`<html><body><nav><a href="/">Home</a></nav><main><article><h1>特定商取引法に基づく表記</h1><dl>${rows}</dl></article></main></body></html>`,
		);
		expect(markdown).toContain("**返品・キャンセル**");
		expect(markdown).toContain("支払方法についての説明文です");
	});
});
