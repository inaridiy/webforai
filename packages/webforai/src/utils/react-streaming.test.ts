import { describe, expect, it } from "vitest";

import { htmlToMarkdown } from "../html-to-markdown";
import { parseHtml, stripScriptBodies } from "./parse-html";
import { resolveStreamedContent } from "./react-streaming";

const convert = (html: string): string => htmlToMarkdown(html, { extractors: false });

describe("content streamed after the shell (React Suspense)", () => {
	const page = (instructions: boolean): string =>
		[
			"<main><h1>Guide</h1><p>Install it:</p>",
			'<!--$?--><template id="B:0"></template><div class="skeleton">Loading…</div><!--/$-->',
			"<p>Then run it.</p></main>",
			'<div hidden id="S:0"><pre><code>npm install</code></pre></div>',
			instructions ? '<script>$RC("B:0","S:0")</script>' : "",
		].join("");

	it("moves a segment into its boundary and drops the fallback", () => {
		expect(convert(page(true))).toBe("# Guide\n\nInstall it:\n\n```\nnpm install\n```\n\nThen run it.\n");
	});

	it("pairs by number when the instruction scripts are gone", () => {
		expect(convert(page(false))).toBe(convert(page(true)));
	});

	it("follows the instructions when the numbers differ, placeholders included", () => {
		const html = [
			'<main><!--$?--><template id="B:1"></template>Loading<!--/$--></main>',
			'<div hidden id="S:4"><p>Body with <template id="P:5"></template>.</p></div>',
			'<div hidden id="S:5"><em>late text</em></div>',
			'<script>$RS("S:5","P:5")</script><script>$RC("B:1","S:4")</script>',
		].join("");
		expect(convert(html)).toBe("Body with *late text*.\n");
	});

	it("keeps a nested boundary's close comment from ending the outer fallback", () => {
		const html = [
			'<main><!--$?--><template id="B:0"></template><!--$-->inner fallback<!--/$--> outer fallback<!--/$--><p>After</p></main>',
			'<div hidden id="S:0"><p>Content</p></div><script>$RC("B:0","S:0")</script>',
		].join("");
		expect(convert(html)).toBe("Content\n\nAfter\n");
	});

	it("moves a segment with more children than a call can take as arguments", () => {
		const html = `<main><!--$?--><template id="B:0"></template>Loading<!--/$--></main><div hidden id="S:0">${"a<br>".repeat(
			150_000,
		)}</div><script>$RC("B:0","S:0")</script>`;
		const tree = parseHtml(html, { fragment: true });
		expect(resolveStreamedContent(tree)).toBe(true);
	});

	it("stays bounded on a page made of placeholders", () => {
		const count = 20_000;
		const html = `<main>${Array.from({ length: count }, (_, i) => `<div hidden id="S:${i}"></div>`).join(
			"",
		)}${Array.from({ length: count }, (_, i) => `<template id="P:${i}"></template>`).join("")}</main>`;
		const tree = parseHtml(html, { fragment: true });
		const started = performance.now();
		resolveStreamedContent(tree);
		expect(performance.now() - started).toBeLessThan(2000);
	});

	it("leaves pages without streamed segments untouched", () => {
		const tree = parseHtml('<template id="B:0"></template><div hidden id="other">x</div>', { fragment: true });
		expect(resolveStreamedContent(tree)).toBe(false);
	});

	it("survives script stripping: the one-line instructions are kept", () => {
		const html = `<script>${"x".repeat(300)}</script><script>$RC("B:1","S:4")</script>`;
		expect(stripScriptBodies(html)).toBe('<script></script><script>$RC("B:1","S:4")</script>');
	});
});
