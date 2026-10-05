import type { Element, ElementContent, Root } from "hast";
import { cloneHast, isElement } from "../../utils/hast-fast";
import { BLOCK_TAGS, type TextBlock } from "../lib/blocks";
import { ROLE_MODELS } from "../lib/role-model.generated";
import {
	type BlockLink,
	LINK_ROLES,
	type LinkRole,
	ROLE_NAMES,
	type RoleModels,
	blockLinks,
	heuristicRoles,
	isUsableRoleModels,
	roleFeatures,
	scoreRoles,
} from "../lib/roles";
import type { ExtractParams, Extractor } from "../types";
import { createAutoExtractor } from "./auto";
import { type KiwameExtractorOptions, type ScoredPage, createKiwameExtractor } from "./kiwame";

/** Section titles of agent output, as the reference outputs name them. */
export const LINK_ROLE_TITLES: Record<LinkRole, string> = {
	related: "Related",
	pagination: "Pagination",
	local_nav: "Section navigation",
	breadcrumb: "Breadcrumb",
	site_nav: "Site navigation",
};

export interface AgentExtractorOptions extends KiwameExtractorOptions {
	/** Link roles to list, in this order. Default: all of {@link LINK_ROLES}. */
	roles?: readonly LinkRole[];
	/** Append reader comments under `## Comments`. Default `true`. */
	comments?: boolean;
	/** Role models; `null` uses class/aria hints only. Defaults to the shipped models. */
	roleModels?: RoleModels | null;
}

const element = (tagName: string, children: ElementContent[], properties: Element["properties"] = {}): Element => ({
	type: "element",
	tagName,
	properties,
	children,
});
const text = (value: string): ElementContent => ({ type: "text", value });

/** A block's own inline content as a paragraph (nested blocks are blocks of their own). */
const inlineCopy = (block: TextBlock): Element => {
	const children = block.owner.children
		.filter((child) => !(isElement(child) && BLOCK_TAGS.has(child.tagName)))
		.map((child) => cloneHast(child as never) as ElementContent);
	return element("p", children);
};

interface Sections {
	comments: Element[];
	links: Map<LinkRole, BlockLink[]>;
}

/** Links of the kept content: agent output lists every other link once, and never these. */
const keptLinks = ({ blocks, probabilities, threshold }: ScoredPage): Set<string> => {
	const seen = new Set<string>();
	for (const block of blocks) {
		if (probabilities[block.index] >= threshold) {
			for (const link of blockLinks(block)) {
				seen.add(link.href);
			}
		}
	}
	return seen;
};

const addLinks = (sections: Sections, role: LinkRole, block: TextBlock, seen: Set<string>): void => {
	for (const link of blockLinks(block)) {
		if (seen.has(link.href)) {
			continue;
		}
		const list = sections.links.get(role) ?? [];
		list.push(link);
		sections.links.set(role, list);
	}
};

/**
 * Lists each link once: a URL found under several roles (a post in both the header menu and the
 * related rail) goes to the most specific one, in {@link LINK_ROLES} order.
 */
const dedupe = (sections: Sections): void => {
	const taken = new Set<string>();
	for (const role of LINK_ROLES) {
		const unique: BlockLink[] = [];
		for (const link of sections.links.get(role) ?? []) {
			if (!taken.has(link.href)) {
				taken.add(link.href);
				unique.push(link);
			}
		}
		sections.links.set(role, unique);
	}
};

const collect = (
	page: ScoredPage,
	roleModels: RoleModels | null,
	wanted: Set<LinkRole>,
	comments: boolean,
): Sections => {
	const { blocks, features, probabilities, threshold } = page;
	const rows = roleFeatures(blocks, features, probabilities, threshold);
	const roles = roleModels ? scoreRoles(rows, blocks.length, roleModels) : heuristicRoles(rows, blocks.length);
	const seen = keptLinks(page);
	const sections: Sections = { comments: [], links: new Map() };
	for (const block of blocks) {
		const role = roles[block.index] < 0 ? undefined : ROLE_NAMES[roles[block.index]];
		if (!role || probabilities[block.index] >= threshold) {
			continue;
		}
		if (role === "comment") {
			if (comments && block.text.length > 0) {
				sections.comments.push(inlineCopy(block));
			}
		} else if (wanted.has(role)) {
			addLinks(sections, role, block, seen);
		}
	}
	dedupe(sections);
	return sections;
};

const append = (tree: Root | Element, sections: Sections, order: readonly LinkRole[]): void => {
	const extra: ElementContent[] = [];
	if (sections.comments.length > 0) {
		extra.push(element("h2", [text("Comments")]), ...sections.comments);
	}
	const groups = order.filter((role) => (sections.links.get(role)?.length ?? 0) > 0);
	if (groups.length > 0) {
		extra.push(element("h2", [text("Links")]));
		for (const role of groups) {
			const items = (sections.links.get(role) ?? []).map((link) =>
				element("li", [element("a", [text(link.text)], { href: link.href })]),
			);
			extra.push(element("h3", [text(LINK_ROLE_TITLES[role])]), element("ul", items));
		}
	}
	(tree.children as ElementContent[]).push(...extra);
};

/**
 * kiwame's main content for an AI agent: the same selection, then reader comments, then the
 * links an agent may follow, grouped by role (related content, pagination, the section's own
 * navigation, the breadcrumb, the site's menus). Boilerplate links (share buttons, ads, sign-up,
 * legal) are left out, and each link is listed once.
 */
export const createAgentExtractor = (options: AgentExtractorOptions = {}): Extractor => {
	const order = options.roles ?? LINK_ROLES;
	const wanted = new Set<LinkRole>(order);
	const comments = options.comments ?? true;
	const shipped = isUsableRoleModels(ROLE_MODELS) ? ROLE_MODELS : null;
	const roleModels = options.roleModels === undefined ? shipped : options.roleModels;
	// Sections are collected when kiwame has scored the page, before pruning empties the dropped blocks.
	let sections: Sections | undefined;
	const kiwame = createKiwameExtractor({
		...options,
		onScored: (page) => {
			sections = collect(page, roleModels, wanted, comments);
			options.onScored?.(page);
		},
	});
	return (params: ExtractParams) => {
		sections = undefined;
		const tree = kiwame(params);
		const found = sections as Sections | undefined;
		if (found && "children" in tree) {
			append(tree as Root | Element, found, order);
		}
		return tree;
	};
};

/** The agent extractor behind the site adapters, like the default `autoExtractor`. */
export const agentExtractor: Extractor = /* @__PURE__ */ createAutoExtractor({
	fallback: /* @__PURE__ */ createAgentExtractor(),
});
