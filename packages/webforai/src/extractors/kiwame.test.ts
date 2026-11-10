import { fromHtml } from "hast-util-from-html";
import { describe, expect, it } from "vitest";

import { htmlToMarkdown } from "../html-to-markdown";
import { MetricsCollector } from "../utils/hast-fast";
import {
	FEATURE_COUNT,
	FEATURE_NAMES,
	STACKED_FEATURE_COUNT,
	blockFeatures,
	stackedFeatures,
} from "./lib/block-features";
import { type BlockModel, isUsableModel, scoreBlocks } from "./lib/block-model";
import { BLOCK_MODEL, BLOCK_STACK_MODEL } from "./lib/block-model.generated";
import { segmentBlocks } from "./lib/blocks";
import { createKiwameExtractor } from "./presets/kiwame";

const page = `<html><body>
	<nav><a href="/">Home</a><a href="/a">About</a></nav>
	<form id="aspnetForm"><div class="content"><h1>Title of the story</h1>
	<p>First paragraph of the story, with enough words to read like prose.</p>
	<table><tr><th>Name</th><th>Price</th></tr><tr><td>Tea</td><td>3</td></tr><tr><td>Cake</td><td>5</td></tr></table>
	</div></form>
	<footer>© Example</footer>
</body></html>`;

/** Rejects blocks inside `<nav>` and keeps everything else. */
const keepLongModel: BlockModel = {
	kind: "trees",
	depth: 1,
	base: 0,
	features: [FEATURE_NAMES.indexOf("in_nav")],
	thresholds: [0.5],
	leaves: [5, -5],
};

describe("block features", () => {
	it("produces one row per block with the declared width", () => {
		const tree = fromHtml(page, { fragment: true });
		const blocks = segmentBlocks(tree);
		const features = blockFeatures({ root: tree, blocks, collector: new MetricsCollector() });
		expect(features.length).toBe(blocks.length * FEATURE_COUNT);
		expect(features.every(Number.isFinite)).toBe(true);
		const stacked = stackedFeatures(blocks, features, new Float32Array(blocks.length).fill(0.5));
		expect(stacked.length).toBe(blocks.length * STACKED_FEATURE_COUNT);
		expect(stacked.every(Number.isFinite)).toBe(true);
	});
});

describe("block model", () => {
	it("ships models that match this build's feature layout", () => {
		expect(isUsableModel(BLOCK_MODEL)).toBe(true);
		if (BLOCK_STACK_MODEL) {
			expect(isUsableModel(BLOCK_STACK_MODEL, STACKED_FEATURE_COUNT)).toBe(true);
		}
	});

	it("evaluates trees", () => {
		const row = new Float32Array(FEATURE_COUNT);
		row[FEATURE_NAMES.indexOf("in_nav")] = 1;
		const [probability] = scoreBlocks(row, 1, keepLongModel);
		expect(probability).toBeLessThan(0.01);
	});
});

describe("kiwame extractor", () => {
	const extractors = createKiwameExtractor({ model: keepLongModel, stackModel: null });

	it("prunes to kept blocks and keeps a form that holds content", () => {
		const markdown = htmlToMarkdown(page, { extractors });
		expect(markdown).toContain("First paragraph of the story");
		expect(markdown).not.toContain("About");
	});

	it("keeps tables rectangular", () => {
		const markdown = htmlToMarkdown(page, { extractors });
		expect(markdown).toContain("| Name | Price |");
		expect(markdown).toContain("| Cake | 5 |");
	});

	it("falls back to the heuristic extractor for an unusable model", () => {
		const fallback = createKiwameExtractor({ model: { kind: "linear", weights: [1] }, stackModel: null });
		expect(htmlToMarkdown(page, { extractors: fallback })).toContain("First paragraph of the story");
	});
});

describe("code inside the content", () => {
	it("keeps an uncertain code block between kept paragraphs", () => {
		const prose = "<p>A paragraph of documentation prose, with commas, that the model keeps.</p>";
		const html = `<html><body><article>${prose.repeat(
			3,
		)}<figure class="preview"><div><pre><code>import * as React from "react"</code></pre></div></figure>${prose.repeat(
			3,
		)}</article></body></html>`;
		const keepProse: BlockModel = {
			kind: "trees",
			depth: 1,
			base: 0,
			features: [FEATURE_NAMES.indexOf("tag_pre")],
			thresholds: [0.5],
			leaves: [5, -1],
		};
		const markdown = htmlToMarkdown(html, {
			extractors: createKiwameExtractor({ model: keepProse, stackModel: null }),
		});
		expect(markdown).toContain('import * as React from "react"');
	});
});

describe("collapsed listings", () => {
	const items = Array.from(
		{ length: 10 },
		(_, index) =>
			`<div class="card"><h2>Story ${index} about rental cars</h2><p>A teaser for story ${index}, with a sentence of summary text.</p></div>`,
	).join("");
	const html = `<html><body><nav><a href="/">Home</a><a href="/news">News</a><a href="/sport">Sport</a></nav><main><h1>Vehicle rental news</h1>${items}</main></body></html>`;
	/** The page heading is sure, every other block uncertain (as the models score teasers). */
	const scoreTeasers = (sure: number, teaser: number) =>
		createKiwameExtractor({
			probabilities: (blocks) =>
				Float32Array.from(blocks, (block) => (block.owner.tagName === "h1" ? sure : block.text ? teaser : 0)),
		});

	it("keeps the uncertain items when only the title was kept", () => {
		const markdown = htmlToMarkdown(html, { extractors: scoreTeasers(0.9, 0.35) });
		expect(markdown).toContain("Story 0 about rental cars");
		expect(markdown).toContain("A teaser for story 9");
		expect(markdown).not.toContain("[Sport]");
	});

	it("leaves blocks below the rescue floor dropped", () => {
		const markdown = htmlToMarkdown(html, { extractors: scoreTeasers(0.9, 0.1) });
		expect(markdown).toContain("Vehicle rental news");
		expect(markdown).not.toContain("Story 0 about rental cars");
	});
});

describe("structure inside the content", () => {
	const prose = "<p>A paragraph of reference prose, with commas, that the model keeps as content.</p>";
	/** Scores every block by its element: prose is kept, the rest is as unsure as on a reference page. */
	const scoreByTag = (scores: Record<string, number>) =>
		createKiwameExtractor({
			probabilities: (blocks) => Float32Array.from(blocks, (block) => scores[block.owner.tagName] ?? 0.9),
		});

	it("keeps the term of a definition whose description is kept", () => {
		const html = `<html><body><main>${prose}<dl>
			<dt><code>resource</code></dt><dd><p>This defines the resource that you wish to fetch.</p></dd>
			<dt><code>options</code></dt><dt><code>init</code></dt><dd><p>An object holding the settings of the request.</p></dd>
		</dl>${prose}</main></body></html>`;
		const markdown = htmlToMarkdown(html, { extractors: scoreByTag({ dt: 0.4 }) });
		expect(markdown).toContain("`resource`");
		expect(markdown).toContain("`options`");
		expect(markdown).toContain("`init`");
	});

	it("does not keep a term whose description was dropped", () => {
		const html = `<html><body><main>${prose}<dl><dt>Sponsor</dt><dd>Buy our product today.</dd></dl>${prose}</main></body></html>`;
		const markdown = htmlToMarkdown(html, { extractors: scoreByTag({ dt: 0.4, dd: 0.1 }) });
		expect(markdown).not.toContain("Sponsor");
	});

	it("keeps a code block separated from the content by a list the models are sure is furniture", () => {
		const toc = `<aside><ul>${"<li>Section</li>".repeat(9)}</ul></aside>`;
		const html = `<html><body><main>${prose}${toc}<h2>Syntax</h2><pre>fetch(resource)</pre><h3>Parameters</h3>${prose}</main></body></html>`;
		const markdown = htmlToMarkdown(html, { extractors: scoreByTag({ li: 0, h2: 0.3, h3: 0.3, pre: 0.45 }) });
		expect(markdown).toContain("## Syntax\n\n```\nfetch(resource)\n```");
		expect(markdown).not.toContain("Section");
	});
});
