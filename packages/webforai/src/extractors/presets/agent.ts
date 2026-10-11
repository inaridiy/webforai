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
	 * Scales how sure the models must be before a block's links are listed: the keep model's
	 * threshold, or each link role's when the role models have no keep model. Default 1; lower
	 * lists more links. A finite number above 0; no effect with `roleModels: null`.
	 */
	keepScale?: number;
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

/** The page's URL, to resolve links against, when it has a valid one. */
const baseOf = (url: string | undefined): URL | undefined => {
	if (!url) {
		return undefined;
	}
	try {
		return new URL(url);
	} catch {
		return undefined;
	}
};

/**
 * A link's identity: its URL resolved against the page's, so `/recipes` and
 * `https://example.com/recipes` are one link. A protocol-relative `//host/…` reads as https when
 * there is no page URL; any other relative `href` without one stays as written.
 */
const linkKey = (href: string, base: URL | undefined): string => {
	try {
		return new URL(href.startsWith("//") && !base ? `https:${href}` : href, base).href;
	} catch {
		return href;
	}
};

/** Share and "send to" endpoints: never a page to go to, whatever the role models say. */
const SHARE_URL =
	/^https?:\/\/([\w-]+\.)*(twitter\.com\/(intent|share)|x\.com\/(intent|share)|facebook\.com\/(sharer|share\.php|dialog\/(share|feed|send))|linkedin\.com\/(sharing\/share-offsite|sharearticle|share|cws\/share)|reddit\.com\/submit|pinterest\.[a-z.]+\/pin\/create|tumblr\.com\/(share|widgets\/share)|wa\.me\/\?|api\.whatsapp\.com\/send|t\.me\/share|telegram\.me\/share|social-plugins\.line\.me|line\.me\/R\/msg|b\.hatena\.ne\.jp\/entry|getpocket\.com\/(save|edit)|news\.ycombinator\.com\/submitlink|bsky\.app\/intent|threads\.(net|com)\/intent|vk\.com\/share\.php|service\.weibo\.com\/share)/i;

const MENU_TAGS = new Set(["nav", "header"]);
const NAV_ROLES = new Set(["navigation", "menu", "menubar"]);
/** Class or id words of menus: `main-nav`, `mainmenu`, `dropdown-menu`, `greedy-nav`, … */
const NAV_HINT = /nav|menu|dropdown/i;
/** Class or id words of consent banners: nothing in them is the site's navigation. */
const CONSENT_HINT = /cookie|consent|gdpr/i;
/**
 * Least share of a menu's text that is link text. A wrapper whose class only mentions navigation
 * (`site has-main-navigation`) holds the article too, and is not a menu.
 */
const MIN_MENU_LINK_DENSITY = 0.5;
/** Most hidden-menu links listed for a page; a mega menu can hold thousands. */
const MAX_HIDDEN_LINKS = 200;

/** Sign-in, account, shop and legal pages: in a hidden menu, never the next page to read. */
const ACCOUNT_OR_LEGAL_PATH =
	/\/(log-?in|log-?out|sign-?in|sign-?out|sign-?up|register|registration|my-?account|account\/(delete|settings)|password|cart|checkout|basket|wishlist|privacy|privacy-policy|privacy-notice|terms|terms-of-use|terms-of-service|terms-and-conditions|tos|cookies?|cookie-policy|cookie-settings|legal|imprint|impressum)\/?([?#.]|$)/i;
const ACCOUNT_OR_LEGAL_TEXT =
	/^(log ?in|log ?out|sign ?in|sign ?out|sign ?up|register|create (an )?account|(my|your) account|delete (my |your )?account|account settings|privacy( policy| settings)?|terms( of (use|service))?|cookie (settings|preferences|policy)|manage cookies|cart|basket|checkout)$/i;

const hintWords = (element: Element): string =>
	`${stringProperty(element, "id") ?? ""} ${classList(element).join(" ")}`;

/** `<nav>`, `<header>`, a menu role, or a menu class or id word. */
const isMenuLike = (element: Element, words: string): boolean =>
	MENU_TAGS.has(element.tagName) || NAV_ROLES.has(stringProperty(element, "role") ?? "") || NAV_HINT.test(words);

const NO_TEXT_TAGS = new Set(["script", "style", "noscript", "template", "svg"]);

/** Share of an element's visible-text characters (whitespace aside) that sit inside links. */
const linkDensity = (element: Element): number => {
	let total = 0;
	let linked = 0;
	const visit = (node: Hast, inLink: boolean): void => {
		if (node.type === "text") {
			const length = node.value.replace(/\s+/g, "").length;
			total += length;
			linked += inLink ? length : 0;
			return;
		}
		if (!isElement(node) || NO_TEXT_TAGS.has(node.tagName)) {
			return;
		}
		for (const child of node.children) {
			visit(child as Hast, inLink || node.tagName === "a");
		}
	};
	visit(element, false);
	return total === 0 ? 1 : linked / total;
};

/**
 * Links in hidden parts of the page's menus: collapsed dropdowns, overflow menus, the mobile
 * menu. Sanitizing removes hidden elements before any block is scored, so no role model sees
 * them, yet they are where a site's deeper sections are linked. Read from the tree before kiwame
 * prunes it; they are listed under Site navigation.
 *
 * With no model to judge them, they are held to a stricter rule than visible links: they must sit
 * in a link-dense menu outside any consent banner; sign-in, account, shop and legal links are left
 * out; and at most {@link MAX_HIDDEN_LINKS} are listed.
 */
export const hiddenNavLinks = (root: Hast, base: URL | undefined, limit = MAX_HIDDEN_LINKS): BlockLink[] => {
	const links: BlockLink[] = [];
	const take = (anchor: Element): void => {
		const link = linkOf(anchor);
		if (link && !isAccountOrLegal(link, base)) {
			links.push(link);
		}
	};
	const visit = (node: Hast, inMenu: boolean, hidden: boolean): void => {
		if (!("children" in node) || links.length >= limit) {
			return;
		}
		const element = isElement(node) ? node : undefined;
		const isHidden = hidden || (element !== undefined && looksHidden(element));
		if (element?.tagName === "a") {
			if (inMenu && isHidden) {
				take(element);
			}
			return;
		}
		const menu = element ? menuState(element, inMenu) : inMenu;
		if (menu === "skip") {
			return;
		}
		for (const child of node.children) {
			visit(child as Hast, menu, isHidden);
		}
	};
	visit(root, false, false);
	return links;
};

/** Whether an element's links are menu links: `"skip"` for a consent banner, which has none. */
const menuState = (element: Element, inMenu: boolean): boolean | "skip" => {
	const words = hintWords(element);
	if (CONSENT_HINT.test(words)) {
		return "skip";
	}
	return inMenu || (isMenuLike(element, words) && linkDensity(element) >= MIN_MENU_LINK_DENSITY);
};

const isAccountOrLegal = (link: BlockLink, base: URL | undefined): boolean => {
	if (ACCOUNT_OR_LEGAL_TEXT.test(link.text)) {
		return true;
	}
	try {
		return ACCOUNT_OR_LEGAL_PATH.test(new URL(linkKey(link.href, base)).pathname);
	} catch {
		return ACCOUNT_OR_LEGAL_PATH.test(link.href.split(/[?#]/)[0]);
	}
};

/** Links of the kept content: agent output lists every other link once, and never these. */
const keptLinks = ({ blocks, probabilities, threshold }: ScoredPage, base: URL | undefined): Set<string> => {
	const seen = new Set<string>();
	for (const block of blocks) {
		if (probabilities[block.index] >= threshold) {
			for (const link of blockLinks(block)) {
				seen.add(linkKey(link.href, base));
			}
		}
	}
	return seen;
};

const listable = (link: BlockLink, seen: Set<string>, base: URL | undefined): boolean => {
	const key = linkKey(link.href, base);
	return !(seen.has(key) || SHARE_URL.test(key));
};

const addLinks = (sections: Sections, role: LinkRole, links: BlockLink[], seen: Set<string>, base: URL | undefined) => {
	const listed = links.filter((link) => listable(link, seen, base));
	if (listed.length > 0) {
		sections.links.set(role, [...(sections.links.get(role) ?? []), ...listed]);
	}
};

/**
 * Lists each link once: a URL found under several roles (a post in both the header menu and the
 * related rail) goes to the most specific one, in {@link LINK_ROLES} order.
 */
const dedupe = (sections: Sections, base: URL | undefined): void => {
	const taken = new Set<string>();
	for (const role of LINK_ROLES) {
		const unique: BlockLink[] = [];
		for (const link of sections.links.get(role) ?? []) {
			const key = linkKey(link.href, base);
			if (!taken.has(key)) {
				taken.add(key);
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
	/** The page's URL, to resolve links against. */
	base?: URL;
	/** Links the content already has, when it is not kiwame's (a site adapter's output). */
	content?: Set<string>;
}

const collect = (
	page: ScoredPage,
	{ roleModels, wanted, comments, hidden, keepScale, base, content }: CollectOptions,
): Sections => {
	const { blocks, features, probabilities, threshold } = page;
	const rows = roleFeatures(blocks, features, probabilities, threshold);
	const roles = roleModels
		? scoreRoles(rows, blocks.length, roleModels, keepScale)
		: heuristicRoles(rows, blocks.length);
	const seen = content ?? keptLinks(page, base);
	const sections: Sections = { comments: [], links: new Map() };
	for (const block of blocks) {
		const role = roles[block.index] < 0 ? undefined : ROLE_NAMES[roles[block.index]];
		// Blocks kiwame keeps are skipped even when an adapter's content replaces kiwame's: what an
		// adapter drops from them is mostly post metadata (author, date and comment-count links), and
		// listing it on the link benchmarks' dev sets added such links and no next link.
		if (!role || probabilities[block.index] >= threshold) {
			continue;
		}
		if (role === "comment") {
			if (comments && block.text.length > 0) {
				sections.comments.push(inlineCopy(block));
			}
		} else if (wanted.has(role)) {
			addLinks(sections, role, blockLinks(block), seen, base);
		}
	}
	if (wanted.has("site_nav")) {
		addLinks(sections, "site_nav", hidden, seen, base);
	}
	dedupe(sections, base);
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

/** Every link in a tree, by {@link linkKey}. */
const linksIn = (tree: Hast, base: URL | undefined): Set<string> => {
	const keys = new Set<string>();
	const visit = (node: Hast): void => {
		if (isElement(node) && node.tagName === "a") {
			const href = stringProperty(node, "href")?.trim();
			if (href) {
				keys.add(linkKey(href, base));
			}
		}
		if ("children" in node) {
			for (const child of node.children) {
				visit(child as Hast);
			}
		}
	};
	visit(tree);
	return keys;
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
	if (options.keepScale !== undefined && !(Number.isFinite(options.keepScale) && options.keepScale > 0)) {
		throw new RangeError("keepScale must be a finite number greater than 0");
	}
	const keepScale = options.keepScale ?? 1;
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
		const base = baseOf(params.url);
		collecting = {
			roleModels,
			wanted,
			comments: comments && !adapted,
			// Read before kiwame runs: it prunes hidden elements, in place when the tree is owned.
			hidden: wanted.has("site_nav") ? hiddenNavLinks(params.hast, base) : [],
			keepScale,
			base,
			content: adapted ? linksIn(adapted, base) : undefined,
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

/** {@link AgentExtractorOptions}, plus the site adapters to try first (`false` for none). */
export type AgentAutoExtractorOptions = AgentExtractorOptions & Pick<AutoExtractorOptions, "adapters">;

/**
 * Agent extraction behind the site adapters: when an adapter claims the page, its output is the
 * content and the page's other links follow it, scored on the original document; otherwise
 * {@link createAgentExtractor}.
 */
export const createAgentAutoExtractor = (options: AgentAutoExtractorOptions = {}): Extractor => {
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
