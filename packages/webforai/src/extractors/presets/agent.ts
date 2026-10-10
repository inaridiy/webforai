import type { Element, ElementContent, Nodes as Hast, Root } from "hast";
import { runAdapters } from "../../adapters";
import { classList, cloneHast, isElement, stringProperty } from "../../utils/hast-fast";
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
	linkOf,
	roleFeatures,
	scoreRoles,
} from "../lib/roles";
import { looksHidden } from "../lib/sanitize";
import type { ExtractParams, Extractor } from "../types";
import { type AutoExtractorOptions, createAutoExtractor } from "./auto";
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
	/**
	 * How sure the models must be before a link is listed, as a multiple of the tuned threshold:
	 * the keep model's when the role models have one (default 1), else each link role's (default
	 * {@link DEFAULT_KEEP_SCALE}). Lower lists more links.
	 */
	keepScale?: number;
}

/**
 * For role models without a keep model. The role thresholds maximise each role's F1, which drops
 * a link whenever its role is unsure.
 * For an agent a missing link costs more than an extra one: on WebWalkerQA's navigation tasks a
 * model picks the right next link as often from agent output as from a list of every link, as
 * long as the link is there. At 0.4 agent mode keeps about 12 points more of those next links
 * for 4% more tokens.
 */
export const DEFAULT_KEEP_SCALE = 0.4;

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

const NAV_TAGS = new Set(["nav", "header"]);
const NAV_ROLES = new Set(["navigation", "menu", "menubar"]);
/** Class or id words of menus: `main-nav`, `mainmenu`, `dropdown-menu`, `greedy-nav`, … */
const NAV_HINT = /nav|menu|dropdown/i;

const isNavContext = (element: Element): boolean =>
	NAV_TAGS.has(element.tagName) ||
	NAV_ROLES.has(stringProperty(element, "role") ?? "") ||
	NAV_HINT.test(stringProperty(element, "id") ?? "") ||
	classList(element).some((name) => NAV_HINT.test(name));

/**
 * Links in hidden parts of the page's navigation: collapsed dropdowns, overflow menus, the mobile
 * menu. Sanitizing removes hidden elements before any block is scored, so no role model sees
 * them, yet they are where a site's deeper sections are linked. Read from the tree before kiwame
 * prunes it; they are listed under Site navigation.
 */
const hiddenNavLinks = (root: Hast): BlockLink[] => {
	const links: BlockLink[] = [];
	const visit = (node: Hast, inNav: boolean, hidden: boolean): void => {
		if (!("children" in node)) {
			return;
		}
		const nav = inNav || (isElement(node) && isNavContext(node));
		const isHidden = hidden || (isElement(node) && looksHidden(node));
		if (isElement(node) && node.tagName === "a" && nav && isHidden) {
			const link = linkOf(node);
			if (link) {
				links.push(link);
			}
			return;
		}
		for (const child of node.children) {
			visit(child as Hast, nav, isHidden);
		}
	};
	visit(root, false, false);
	return links;
};

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

/** Share and "send to" endpoints: never a page to go to, whatever the role models say. */
const SHARE_URL =
	/^https?:\/\/(www\.)?(twitter\.com\/(intent|share)|x\.com\/intent|facebook\.com\/(sharer|share\.php|dialog\/share)|linkedin\.com\/(sharearticle|shareArticle|share)|reddit\.com\/submit|pinterest\.[a-z.]+\/pin\/create|tumblr\.com\/(share|widgets\/share)|wa\.me\/\?|api\.whatsapp\.com\/send|t\.me\/share|telegram\.me\/share|social-plugins\.line\.me|line\.me\/R\/msg|b\.hatena\.ne\.jp\/entry|getpocket\.com\/(save|edit)|news\.ycombinator\.com\/submitlink)/i;

const addLinks = (sections: Sections, role: LinkRole, block: TextBlock, seen: Set<string>): void => {
	for (const link of blockLinks(block)) {
		if (seen.has(link.href) || SHARE_URL.test(link.href)) {
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

interface CollectOptions {
	roleModels: RoleModels | null;
	wanted: Set<LinkRole>;
	comments: boolean;
	/** Links of hidden navigation, read before sanitizing. */
	hidden: BlockLink[];
	keepScale: number;
	/** Links the content already has, when it is not kiwame's (a site adapter's output). */
	content?: Set<string>;
}

const collect = (
	page: ScoredPage,
	{ roleModels, wanted, comments, hidden, keepScale, content }: CollectOptions,
): Sections => {
	const { blocks, features, probabilities, threshold } = page;
	const rows = roleFeatures(blocks, features, probabilities, threshold);
	const roles = roleModels
		? scoreRoles(rows, blocks.length, roleModels, keepScale)
		: heuristicRoles(rows, blocks.length);
	const seen = content ?? keptLinks(page);
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
	if (wanted.has("site_nav")) {
		const list = sections.links.get("site_nav") ?? [];
		list.push(...hidden.filter((link) => !(seen.has(link.href) || SHARE_URL.test(link.href))));
		sections.links.set("site_nav", list);
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

/** Every `href` in a tree, as written. */
const hrefsIn = (tree: Hast): Set<string> => {
	const hrefs = new Set<string>();
	const visit = (node: Hast): void => {
		if (isElement(node) && node.tagName === "a") {
			const href = stringProperty(node, "href")?.trim();
			if (href) {
				hrefs.add(href);
			}
		}
		if ("children" in node) {
			for (const child of node.children) {
				visit(child as Hast);
			}
		}
	};
	visit(tree);
	return hrefs;
};

/**
 * Runs agent extraction on a page. With `adapted` (a site adapter's output for it), that output is
 * the content: kiwame still scores the original document so the page's other links can be listed,
 * minus those the adapter kept, and comments are left to the adapter.
 */
type AgentRun = (params: ExtractParams, adapted?: Hast) => Hast;

const createAgentRun = (options: AgentExtractorOptions): AgentRun => {
	const order = options.roles ?? LINK_ROLES;
	const wanted = new Set<LinkRole>(order);
	const comments = options.comments ?? true;
	const shipped = isUsableRoleModels(ROLE_MODELS) ? ROLE_MODELS : null;
	const roleModels = options.roleModels === undefined ? shipped : options.roleModels;
	const keepScale = options.keepScale ?? (roleModels?.keep ? 1 : DEFAULT_KEEP_SCALE);
	// Sections are collected when kiwame has scored the page, before pruning empties the dropped blocks.
	let sections: Sections | undefined;
	let collecting: CollectOptions = { roleModels, wanted, comments, hidden: [], keepScale };
	const kiwame = createKiwameExtractor({
		...options,
		onScored: (page) => {
			sections = collect(page, collecting);
			options.onScored?.(page);
		},
	});
	return (params, adapted) => {
		sections = undefined;
		collecting = {
			roleModels,
			wanted,
			comments: comments && !adapted,
			// Read before kiwame runs: it prunes hidden elements, in place when the tree is owned.
			hidden: wanted.has("site_nav") ? hiddenNavLinks(params.hast) : [],
			keepScale,
			content: adapted ? hrefsIn(adapted) : undefined,
		};
		const tree = kiwame(adapted ? { ...params, report: undefined } : params);
		const target = adapted ?? tree;
		const found = sections as Sections | undefined;
		if (found && "children" in target) {
			append(target as Root | Element, found, order);
		}
		return target;
	};
};

/**
 * kiwame's main content for an AI agent: the same selection, then reader comments, then the
 * links an agent may follow, grouped by role (related content, pagination, the section's own
 * navigation, the breadcrumb, the site's menus). Boilerplate links (share buttons, ads, sign-up,
 * legal) are left out, and each link is listed once.
 */
export const createAgentExtractor = (options: AgentExtractorOptions = {}): Extractor => {
	const run = createAgentRun(options);
	return (params) => run(params);
};

/**
 * Agent extraction behind the site adapters: when an adapter claims the page, its output is the
 * content and the page's other links follow it, scored on the original document; otherwise
 * {@link createAgentExtractor}.
 */
export const createAgentAutoExtractor = (
	options: AgentExtractorOptions & Pick<AutoExtractorOptions, "adapters"> = {},
): Extractor => {
	const run = createAgentRun(options);
	return (params) => {
		if (options.adapters !== false) {
			const extracted = runAdapters(
				{ hast: params.hast, url: params.url, lang: params.lang },
				options.adapters ?? undefined,
			);
			if (extracted) {
				params.report?.({ extractor: "adapter" });
				return run(params, extracted);
			}
		}
		return run(params);
	};
};

/** The agent extractor behind the site adapters, like the default `autoExtractor`. */
export const agentExtractor: Extractor = /* @__PURE__ */ createAgentAutoExtractor();

/**
 * The default extraction plus reader comments under `## Comments`, without the link sections:
 * the content a reader-mode extractor that keeps comments returns (Trafilatura does by default).
 */
export const commentsExtractor: Extractor = /* @__PURE__ */ createAutoExtractor({
	fallback: /* @__PURE__ */ createAgentExtractor({ roles: [] }),
});
