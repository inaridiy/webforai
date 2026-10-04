import type { Element, Nodes } from "hast";
import { type MetricsCollector, findElement, stringProperty } from "../../utils/hast-fast";
import type { BlockFrame, TextBlock } from "./blocks";

type Hast = Nodes;

const TOKEN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu;

/** Lower-cased, NFKC-normalised tokens; CJK characters one by one. */
const tokenize = (text: string): string[] => text.normalize("NFKC").toLowerCase().match(TOKEN) ?? [];

const textOf = (node: Hast | undefined): string => {
	if (!node) {
		return "";
	}
	let out = "";
	const visit = (current: { type: string; value?: string; children?: unknown[] }) => {
		if (current.type === "text") {
			out += current.value ?? "";
		}
		for (const child of current.children ?? []) {
			visit(child as typeof current);
		}
	};
	visit(node as never);
	return out.replace(/\s+/g, " ").trim();
};

/**
 * The page's own name for itself: `og:title`, else `<title>`.
 *
 * Read before invisible content is stripped, which removes both.
 */
export const pageTitle = (tree: Hast): string => {
	const og = findElement(
		tree,
		(element) =>
			element.tagName === "meta" &&
			(stringProperty(element, "property") === "og:title" || stringProperty(element, "name") === "og:title"),
	);
	const ogTitle = og ? stringProperty(og, "content") ?? "" : "";
	if (ogTitle.trim()) {
		return ogTitle;
	}
	return textOf(findElement(tree, (element) => element.tagName === "title"));
};

export const TITLE_FEATURE_NAMES = [
	"t_has",
	"t_dice",
	"t_cover",
	"t_isAnchor",
	"t_after",
	"t_logDist",
	"t_relDist",
	"t_treeDist",
	"t_lcaShare",
	"t_lcaDepthRel",
] as const;

const framesOf = (frame: BlockFrame | undefined): BlockFrame[] => {
	const out: BlockFrame[] = [];
	for (let current = frame; current; current = current.parent) {
		out.push(current);
	}
	return out.reverse();
};

const lowestCommon = (a: BlockFrame[], b: BlockFrame[]): BlockFrame | undefined => {
	let common: BlockFrame | undefined;
	for (let index = 0; index < Math.min(a.length, b.length); index++) {
		if (a[index] !== b[index]) {
			break;
		}
		common = a[index];
	}
	return common;
};

const ANCHOR_MIN_SCORE = 0.3;

/** Overlap of each block with the title; the anchor is the best non-link block, headings preferred. */
const findAnchor = (blocks: TextBlock[], title: Set<string>) => {
	const dice = new Float32Array(blocks.length);
	const cover = new Float32Array(blocks.length);
	let anchor = -1;
	let best = 0;
	for (const block of blocks) {
		const tokens = tokenize(block.text);
		if (title.size === 0 || tokens.length === 0) {
			continue;
		}
		const set = new Set(tokens);
		let common = 0;
		for (const token of set) {
			if (title.has(token)) {
				common += 1;
			}
		}
		dice[block.index] = (2 * common) / (set.size + title.size);
		cover[block.index] = common / title.size;
		const tag = block.owner.tagName;
		const score = dice[block.index] * (tag === "h1" ? 1.5 : /^h[23]$/.test(tag) ? 1.2 : 1);
		if (score > best && block.linkChars < block.text.length * 0.5) {
			best = score;
			anchor = block.index;
		}
	}
	return { dice, cover, anchor: best < ANCHOR_MIN_SCORE ? -1 : anchor };
};

/**
 * Where each block sits relative to the block that names the page (the title anchor).
 *
 * A product page lists other products and an article links other articles, in the same markup as
 * the page's own; the title tells which one the page is about, and the content near it in the
 * tree is the main content.
 */
export const titleFeatures = (blocks: TextBlock[], title: string, collector: MetricsCollector): Float32Array => {
	const width = TITLE_FEATURE_NAMES.length;
	const out = new Float32Array(blocks.length * width);
	const { dice, cover, anchor } = findAnchor(blocks, new Set(tokenize(title)));
	const totalText = Math.max(
		1,
		blocks.reduce((sum, block) => sum + block.text.length, 0),
	);
	const anchorPath = anchor >= 0 ? framesOf(blocks[anchor].frame) : [];
	const count = blocks.length;
	for (const block of blocks) {
		const index = block.index;
		let f = index * width;
		out[f++] = anchor >= 0 ? 1 : 0;
		out[f++] = dice[index];
		out[f++] = cover[index];
		out[f++] = index === anchor ? 1 : 0;
		if (anchor < 0) {
			out.set([0.5, 0, 0, -1, -1, -1], f);
			continue;
		}
		const path = framesOf(block.frame);
		const common = lowestCommon(path, anchorPath);
		const depth = common?.depth ?? 0;
		const share = common ? collector.textLength(common.element) / totalText : 1;
		out[f++] = index >= anchor ? 1 : 0;
		out[f++] = Math.sign(index - anchor) * Math.log1p(Math.abs(index - anchor));
		out[f++] = (index - anchor) / Math.max(1, count - 1);
		out[f++] = Math.log1p(path.length + anchorPath.length - 2 * depth);
		out[f++] = Math.min(1, share);
		out[f++] = path.length === 0 ? 0 : depth / path.length;
	}
	return out;
};
