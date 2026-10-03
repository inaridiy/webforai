/**
 * kiwame — main-content extraction by a learned block classifier.
 *
 * "kiwame" is written 極め in Japanese: the appraiser's verdict on a piece of work. It judges every
 * block, taking the craftsman `takumi`'s own choice into account.
 *
 * The page is segmented into text blocks, every block gets a probability of being main content
 * from a logistic model over cheap local features (see `block-features.ts`), and the tree is
 * pruned to the blocks above the threshold — keeping the original element structure, so headings,
 * lists, tables and code convert exactly as before. When the model keeps nothing the heuristic
 * extractor runs instead.
 */

import type { Element, ElementContent, Nodes as Hast, Root, RootContent } from "hast";

import { MetricsCollector, cloneHast, findElement, isElement, walk } from "../../utils/hast-fast";
import { FEATURE_COUNT, STACKED_FEATURE_COUNT, blockFeatures, stackedFeatures } from "../lib/block-features";
import { type BlockModel, isUsableModel, scoreBlocks } from "../lib/block-model";
import { BLOCK_MODEL, BLOCK_STACK_MODEL } from "../lib/block-model.generated";
import { BLOCK_TAGS, type BlockFrame, type TextBlock, segmentBlocks } from "../lib/blocks";
import { type ConfidenceInput, confidenceFeatures, scoreConfidence } from "../lib/confidence";
import { CONFIDENCE_MODEL } from "../lib/confidence-model.generated";
import { unwrapLayoutTables } from "../lib/layout-tables";
import { REFERENCE_HEADING, cleanContent, stripNonContent } from "../lib/sanitize";
import { takumiSelection } from "../lib/takumi-signal";
import type { ExtractParams, ExtractionReport, Extractor } from "../types";
import { takumiExtractor } from "./takumi";

/**
 * Probability above which a block is kept, tuned together with the model's training settings.
 */
export const DEFAULT_THRESHOLD = 0.47;

export interface KiwameExtractorOptions {
	/** Probability above which a block is kept. Default {@link DEFAULT_THRESHOLD}. */
	threshold?: number;
	/** The block classifier; defaults to the shipped model. */
	model?: BlockModel;
	/** Second stage over context aggregates of the first; `null` disables it. */
	stackModel?: BlockModel | null;
	/** Run the widget clean-up of the heuristic extractor on the result. Default `true`. */
	cleanup?: boolean;
	/** Page-confidence model (see `lib/confidence`); defaults to the shipped one. */
	confidenceModel?: BlockModel;
}

const findBody = (hast: Hast): Hast => findElement(hast, (element) => element.tagName === "body") ?? hast;

/**
 * Adds the cells a table needs to stay rectangular: a kept cell keeps its whole row, and a table
 * with any kept row keeps its first row (the header).
 */
const completeTables = (kept: Set<Element>, blocks: TextBlock[]): void => {
	const rows = new Set<Element>();
	const tables = new Set<Element>();
	for (const block of blocks) {
		if (!kept.has(block.owner)) {
			continue;
		}
		const { row, table } = enclosingTable(block.frame);
		if (row) {
			rows.add(row);
		}
		if (table) {
			tables.add(table);
		}
	}
	for (const table of tables) {
		const first = findElement(table, (element) => element.tagName === "tr");
		if (first) {
			rows.add(first);
		}
	}
	for (const block of blocks) {
		const { row } = enclosingTable(block.frame);
		if (row && rows.has(row)) {
			kept.add(block.owner);
		}
	}
};

/** The nearest `tr` and `table` above a block, stopping at the table. */
const enclosingTable = (start: BlockFrame): { row?: Element; table?: Element } => {
	let row: Element | undefined;
	for (let frame: BlockFrame | undefined = start; frame; frame = frame.parent) {
		const tag = frame.element.tagName;
		if (tag === "tr" && !row) {
			row = frame.element;
		} else if (tag === "table") {
			return { row, table: frame.element };
		}
	}
	return { row };
};

/** Blocks after a heading that decide whether the heading belongs to the content. */
const HEADING_LOOKAHEAD = 3;

/**
 * Keeps section headings that sit inside the kept content.
 *
 * A short heading carries little evidence of its own, so the model is unsure of "Syntax" or
 * "Parameters" even in the middle of an article. A heading is kept when the content after it
 * (within a few blocks) is kept and some kept content precedes it — boilerpipe's rule of attaching
 * titles to the text they introduce. A rail's heading fails the first test, a footer's the second.
 */
const keepSectionHeadings = (kept: Set<Element>, blocks: TextBlock[]): void => {
	let seenKept = false;
	for (let index = 0; index < blocks.length; index++) {
		const block = blocks[index];
		if (kept.has(block.owner)) {
			seenKept = true;
			continue;
		}
		if (!(seenKept && /^h[1-6]$/.test(block.owner.tagName))) {
			continue;
		}
		for (let next = index + 1; next < Math.min(blocks.length, index + 1 + HEADING_LOOKAHEAD); next++) {
			if (/^h[1-6]$/.test(blocks[next].owner.tagName)) {
				break;
			}
			if (kept.has(blocks[next].owner)) {
				kept.add(block.owner);
				break;
			}
		}
	}
};

/** Lowest probability at which a code block inside the content is still kept. */
const CODE_IN_CONTENT_THRESHOLD = 0.2;

/** How far (in blocks) kept content must be on both sides of a code block. */
const CODE_CONTEXT = 6;

/**
 * Keeps code blocks that sit inside the kept content.
 *
 * Documentation puts examples in preview widgets and collapsible frames whose markup looks like
 * page furniture, so the model is unsure of them (0.3–0.45 on shadcn/ui) even between paragraphs it
 * keeps. A code block surrounded by kept content is part of it; one in a rail or footer is not.
 */
const keepCodeInContent = (kept: Set<Element>, blocks: TextBlock[], probabilities: Float32Array): void => {
	const keptIndex = blocks.map((block) => kept.has(block.owner));
	const near = (from: number, step: number): boolean => {
		for (let distance = 1; distance <= CODE_CONTEXT; distance++) {
			const index = from + step * distance;
			if (index < 0 || index >= blocks.length) {
				return false;
			}
			if (keptIndex[index]) {
				return true;
			}
		}
		return false;
	};
	for (const block of blocks) {
		if (
			block.owner.tagName === "pre" &&
			!keptIndex[block.index] &&
			probabilities[block.index] >= CODE_IN_CONTENT_THRESHOLD &&
			near(block.index, -1) &&
			near(block.index, 1)
		) {
			kept.add(block.owner);
		}
	}
};

/** The `ul`/`ol` a list-item block belongs to, if any. */
const listOf = (block: TextBlock): Element | undefined => {
	if (block.owner.tagName !== "li") {
		return undefined;
	}
	for (let frame = block.frame.parent; frame; frame = frame.parent) {
		const tag = frame.element.tagName;
		if (tag === "ul" || tag === "ol") {
			return frame.element;
		}
	}
	return undefined;
};

/**
 * Keeps link lists the author wrote: one introduced by a sentence ending in a colon, and one
 * under a reference heading ("See also", "参考文献"). They look exactly like navigation, so the
 * heuristic extractor exempts the same two shapes; only lists inside the kept content qualify.
 */
const keepAuthoredLists = (kept: Set<Element>, blocks: TextBlock[]): void => {
	let seenKept = false;
	for (let index = 0; index < blocks.length - 1; index++) {
		const block = blocks[index];
		const introducesList =
			(kept.has(block.owner) && /[:：]\s*$/.test(block.text)) ||
			(seenKept && /^h[1-6]$/.test(block.owner.tagName) && REFERENCE_HEADING.test(block.text.trim()));
		seenKept ||= kept.has(block.owner);
		const list = listOf(blocks[index + 1]);
		if (!(introducesList && list)) {
			continue;
		}
		kept.add(block.owner);
		for (let next = index + 1; next < blocks.length && listOf(blocks[next]) === list; next++) {
			kept.add(blocks[next].owner);
		}
	}
};

/**
 * Removes everything that is not a kept block or an ancestor of one.
 *
 * Inline content belongs to the nearest block-level ancestor and survives only when that block
 * was kept; structural wrappers survive only as the path to kept blocks.
 */
const pruneToBlocks = (element: Element | Root, kept: Set<Element>, ownerKept: boolean): boolean => {
	const isBlock = element.type === "element" && (BLOCK_TAGS.has(element.tagName) || element.tagName === "pre");
	const selfKept = isBlock ? kept.has(element as Element) : ownerKept;
	// Preformatted text is one block: its line `div`s are part of it, never blocks of their own.
	if (element.type === "element" && element.tagName === "pre") {
		return selfKept;
	}
	let keepChildren = false;

	const children: Array<ElementContent | RootContent> = [];
	for (const child of element.children) {
		if (child.type === "element") {
			if (pruneToBlocks(child, kept, selfKept)) {
				children.push(child);
				keepChildren = true;
			}
		} else if (child.type === "text") {
			if (selfKept) {
				children.push(child);
			}
		} else {
			children.push(child);
		}
	}
	element.children = children as typeof element.children;
	return selfKept || keepChildren;
};

/** The extraction report: which extractor ran and the page confidence. */
const report = (input: ConfidenceInput, model: BlockModel | undefined): ExtractionReport => ({
	extractor: input.fellBack ? "takumi" : "kiwame",
	confidence: scoreConfidence(confidenceFeatures(input), model),
});

export const createKiwameExtractor = (options: KiwameExtractorOptions = {}): Extractor => {
	const {
		threshold = DEFAULT_THRESHOLD,
		model = BLOCK_MODEL,
		cleanup = true,
		confidenceModel = CONFIDENCE_MODEL,
	} = options;
	const stackModel = options.stackModel === undefined ? BLOCK_STACK_MODEL : options.stackModel;
	const usable = isUsableModel(model);
	const stackUsable = stackModel ? isUsableModel(stackModel, STACKED_FEATURE_COUNT) : false;

	return (params: ExtractParams): Hast => {
		if (!usable) {
			return takumiExtractor(params);
		}

		const { hast, lang, owned } = params;
		const body = owned ? findBody(hast) : cloneHast(findBody(hast));
		stripNonContent(body);

		const blocks = segmentBlocks(body);
		if (blocks.length === 0 || !(isElement(body) || body.type === "root")) {
			return body;
		}

		const collector = new MetricsCollector();
		const takumiKept = takumiSelection(body, lang, params.url);
		const features = blockFeatures({ root: body, blocks, collector, lang, takumiKept });
		let probabilities = scoreBlocks(features, blocks.length, model, FEATURE_COUNT);
		if (stackModel && stackUsable) {
			const stacked = stackedFeatures(blocks, features, probabilities);
			probabilities = scoreBlocks(stacked, blocks.length, stackModel, STACKED_FEATURE_COUNT);
		}

		const kept = new Set<Element>();
		for (const block of blocks) {
			if (probabilities[block.index] >= threshold) {
				kept.add(block.owner);
			}
		}
		const fellBack = kept.size === 0;
		params.report?.(report({ blocks, probabilities, threshold, takumiKept, fellBack }, confidenceModel));
		if (fellBack) {
			return takumiExtractor({ hast: body, lang, url: params.url, owned: true });
		}

		keepCodeInContent(kept, blocks, probabilities);
		keepSectionHeadings(kept, blocks);
		keepAuthoredLists(kept, blocks);
		completeTables(kept, blocks);
		pruneToBlocks(body, kept, false);
		unwrapLayoutTables(body);
		if (!cleanup) {
			return body;
		}
		// A form that survived pruning holds kept content — ASP.NET wraps the whole page in one —
		// so it is a container here, not the widget the clean-up removes.
		walk(body, (node) => {
			if (isElement(node) && (node.tagName === "form" || node.tagName === "fieldset")) {
				node.tagName = "div";
			}
		});
		return cleanContent(body, new MetricsCollector());
	};
};

/** The learned extractor with the shipped model. */
export const kiwameExtractor: Extractor = createKiwameExtractor();
