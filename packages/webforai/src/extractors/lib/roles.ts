import type { Element, ElementContent } from "hast";
import { classList, isElement, stringProperty } from "../../utils/hast-fast";
import { FEATURE_COUNT, FEATURE_NAMES } from "./block-features";
import { type BlockModel, isUsableModel, scoreBlocks } from "./block-model";
import { BLOCK_TAGS, type BlockFrame, type TextBlock } from "./blocks";

/**
 * Roles of the blocks kiwame did not keep, for agent-mode output: the links an agent may follow
 * (related content, the next page, the surrounding section, the path to the page, the site's
 * menus) and reader comments. Anything else is boilerplate.
 */
export const ROLE_NAMES = ["comment", "related", "pagination", "local_nav", "breadcrumb", "site_nav"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/** The link roles, in the order agent output lists them. */
export const LINK_ROLES = ["related", "pagination", "local_nav", "breadcrumb", "site_nav"] as const;
export type LinkRole = (typeof LINK_ROLES)[number];

export const ROLE_EXTRA_NAMES = [
	"hint_breadcrumb",
	"hint_pagination",
	"hint_related",
	"hint_local",
	"hint_global",
	"hint_comment",
	"rel_next",
	"p_main",
	"kept",
	"dist_kept",
	"before_kept",
	"after_kept",
	"link_items",
] as const;

export const ROLE_FEATURE_NAMES = [...FEATURE_NAMES, ...ROLE_EXTRA_NAMES] as const;
export const ROLE_FEATURE_COUNT = ROLE_FEATURE_NAMES.length;

const HINTS: Array<[number, RegExp]> = [
	[0, /bread|crumb/i],
	[1, /paginat|pager|paging|page-?num|nav-?links|next|prev|older|newer|load-?more/i],
	[
		2,
		/related|recommend|similar|you-?may|also-?like|more-?(from|posts|articles|stories|news)|popular|trending|read-?next|\btags?\b|tag-?list|post-?tags|categor/i,
	],
	[
		3,
		/\btoc\b|table-?of-?contents|sidebar|side-?nav|sub-?nav|sub-?menu|local-?nav|chapters?|docs?-?nav|on-?this-?page|secondary|section-?nav/i,
	],
	[4, /header|footer|navbar|global|main-?nav|menu|masthead|site-?nav|top-?nav|mega|bottom-?nav/i],
	[5, /comment|repl(y|ies)|discussion|disqus|respond/i],
];
const HINT_DEPTH = 6;

const attributeText = (element: Element): string =>
	[
		classList(element).join(" "),
		stringProperty(element, "id") ?? "",
		stringProperty(element, "ariaLabel") ?? "",
		stringProperty(element, "role") ?? "",
		stringProperty(element, "itemType") ?? "",
	].join(" ");

/** Role hints from the class, id, aria-label, role and itemtype of the owner and its nearest ancestors. */
const hintsOf = (block: TextBlock, cache: Map<Element, number>): number[] => {
	const out = [0, 0, 0, 0, 0, 0];
	let frame: BlockFrame | undefined = block.frame;
	for (let depth = 0; depth < HINT_DEPTH && frame; depth++, frame = frame.parent) {
		let bits = cache.get(frame.element);
		if (bits === undefined) {
			const text = attributeText(frame.element);
			bits = 0;
			for (const [index, pattern] of HINTS) {
				if (pattern.test(text)) {
					bits |= 1 << index;
				}
			}
			if (frame.element.tagName === "nav" || frame.element.tagName === "header" || frame.element.tagName === "footer") {
				bits |= 1 << 4;
			}
			cache.set(frame.element, bits);
		}
		for (let index = 0; index < out.length; index++) {
			if (bits & (1 << index)) {
				out[index] = 1;
			}
		}
	}
	return out;
};

export interface BlockLink {
	href: string;
	text: string;
	rel: string;
}

const UNFOLLOWABLE = /^(#|javascript:|mailto:|tel:|data:)/i;

const textOf = (node: ElementContent): string => {
	if (node.type === "text") {
		return node.value;
	}
	if (node.type !== "element") {
		return "";
	}
	return node.children.map((child) => textOf(child)).join("");
};

const linkCache = new WeakMap<TextBlock, BlockLink[]>();

/** Links in a block's own inline content (not inside nested block elements); cached per block. */
export const blockLinks = (block: TextBlock): BlockLink[] => {
	const cached = linkCache.get(block);
	if (cached) {
		return cached;
	}
	const out: BlockLink[] = [];
	const visit = (element: Element) => {
		for (const child of element.children) {
			if (!isElement(child) || BLOCK_TAGS.has(child.tagName)) {
				continue;
			}
			if (child.tagName === "a") {
				const href = stringProperty(child, "href")?.trim();
				const text = textOf(child).replace(/\s+/g, " ").trim();
				if (href && text && !UNFOLLOWABLE.test(href)) {
					const rel = child.properties?.rel;
					out.push({ href, text, rel: Array.isArray(rel) ? rel.join(" ") : String(rel ?? "") });
				}
				continue;
			}
			visit(child);
		}
	};
	visit(block.owner);
	linkCache.set(block, out);
	return out;
};

/** Each block's signed distance (in blocks) to the nearest kept block; 0 when nothing is kept. */
const signedDistances = (kept: number[], count: number): Int32Array => {
	const out = new Int32Array(count);
	if (kept.length === 0) {
		return out;
	}
	let pointer = 0;
	for (let index = 0; index < count; index++) {
		while (pointer + 1 < kept.length && Math.abs(kept[pointer + 1] - index) <= Math.abs(kept[pointer] - index)) {
			pointer += 1;
		}
		out[index] = index - kept[pointer];
	}
	return out;
};

/**
 * Feature rows for the role models: the block's kiwame features, then {@link ROLE_EXTRA_NAMES}.
 *
 * `probabilities` are kiwame's final main-content probabilities; blocks at or above `threshold`
 * are the kept content, and a block's distance to it (signed, in blocks) tells a breadcrumb above
 * the article from pagination and related rails below it.
 */
export const roleFeatures = (
	blocks: TextBlock[],
	features: Float32Array,
	probabilities: Float32Array,
	threshold: number,
): Float32Array => {
	const count = blocks.length;
	const out = new Float32Array(count * ROLE_FEATURE_COUNT);
	const kept = blocks.filter((block) => probabilities[block.index] >= threshold).map((block) => block.index);
	const first = kept.length > 0 ? kept[0] : -1;
	const last = kept.length > 0 ? kept[kept.length - 1] : -1;
	const nearest = signedDistances(kept, count);
	const cache = new Map<Element, number>();
	for (const block of blocks) {
		const index = block.index;
		const row = index * ROLE_FEATURE_COUNT;
		out.set(features.subarray(index * FEATURE_COUNT, (index + 1) * FEATURE_COUNT), row);
		let f = row + FEATURE_COUNT;
		for (const hint of hintsOf(block, cache)) {
			out[f++] = hint;
		}
		const links = blockLinks(block);
		out[f++] = links.some((link) => /\b(next|prev)\b/i.test(link.rel)) ? 1 : 0;
		out[f++] = probabilities[index];
		out[f++] = probabilities[index] >= threshold ? 1 : 0;
		out[f++] = kept.length > 0 ? Math.sign(nearest[index]) * Math.log1p(Math.abs(nearest[index])) : 0;
		out[f++] = first >= 0 && index < first ? 1 : 0;
		out[f++] = last >= 0 && index > last ? 1 : 0;
		out[f++] = Math.log1p(links.length);
	}
	return out;
};

/** One binary model per role over {@link ROLE_FEATURE_NAMES}, and the probability each needs. */
export interface RoleModels {
	models: Record<RoleName, BlockModel>;
	thresholds: Record<RoleName, number>;
}

export const isUsableRoleModels = (models: RoleModels | undefined): models is RoleModels =>
	models !== undefined &&
	ROLE_NAMES.every((role) => models.models[role] && isUsableModel(models.models[role], ROLE_FEATURE_COUNT));

/** Each block's role (index into {@link ROLE_NAMES}), or -1 for boilerplate. */
export const scoreRoles = (rows: Float32Array, count: number, roleModels: RoleModels): Int8Array => {
	const out = new Int8Array(count).fill(-1);
	const best = new Float32Array(count);
	ROLE_NAMES.forEach((role, roleIndex) => {
		const p = scoreBlocks(rows, count, roleModels.models[role], ROLE_FEATURE_COUNT);
		const threshold = roleModels.thresholds[role];
		for (let index = 0; index < count; index++) {
			const margin = p[index] / threshold;
			if (p[index] >= threshold && margin > best[index]) {
				best[index] = margin;
				out[index] = roleIndex;
			}
		}
	});
	return out;
};

const HINT_ROLE: Array<[number, RoleName]> = [
	[0, "breadcrumb"],
	[1, "pagination"],
	[5, "comment"],
	[2, "related"],
	[3, "local_nav"],
	[4, "site_nav"],
];

/** Roles from the class/aria hints alone, in a fixed priority; the baseline the models must beat. */
export const heuristicRoles = (rows: Float32Array, count: number): Int8Array => {
	const out = new Int8Array(count).fill(-1);
	const base = FEATURE_COUNT;
	for (let index = 0; index < count; index++) {
		const row = index * ROLE_FEATURE_COUNT;
		if (rows[row + base + 6] === 1) {
			out[index] = ROLE_NAMES.indexOf("pagination");
			continue;
		}
		for (const [hint, role] of HINT_ROLE) {
			if (rows[row + base + hint] === 1) {
				out[index] = ROLE_NAMES.indexOf(role);
				break;
			}
		}
	}
	return out;
};
