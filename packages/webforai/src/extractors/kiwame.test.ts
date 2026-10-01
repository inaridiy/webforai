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
		expect(markdown).toContain("| Cake | 5     |");
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
