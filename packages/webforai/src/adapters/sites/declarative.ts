/**
 * Selector-driven site adapters.
 *
 * Every selector here was verified against a real capture of the site rather than recalled, and
 * each spec carries a fingerprint where one exists so that self-hosted instances of the same
 * platform are covered too, not just the flagship domain.
 */

import type { Nodes as Hast } from "hast";

import { defineSelectorAdapter } from "../registry";
import type { SelectorAdapterSpec, SiteAdapter } from "../types";

/** Widgets that appear inside article bodies on most platforms. */
const COMMON_NOISE = [
	".sr-only",
	"[aria-hidden='true'][class*='icon']",
	"button",
	".social-share",
	".share-buttons",
	".newsletter-signup",
];

const SPECS: SelectorAdapterSpec[] = [
	{
		id: "github",
		hosts: /(^|\.)github\.com$/,
		// Issues and PRs expose a testid; repository landing pages render the README instead.
		content: ["[data-testid='issue-body']", "article.markdown-body", ".markdown-body"],
		remove: [".js-comment-edit-history", ".Details-content--hidden", "clipboard-copy", ...COMMON_NOISE],
		minLength: 30,
	},
	{
		id: "stackoverflow",
		hosts: /(^|\.)(stackoverflow\.com|stackexchange\.com|superuser\.com|serverfault\.com|askubuntu\.com)$/,
		content: ["#mainbar", ".question, .answer"],
		remove: [
			".js-post-menu",
			".post-menu",
			".user-info",
			".votecell",
			".comments-link",
			".js-add-link",
			...COMMON_NOISE,
		],
		minLength: 100,
	},
	{
		id: "npm",
		hosts: /(^|\.)npmjs\.com$/,
		content: ["#readme", "#package-tab-readme", "[class*='markdown']"],
		remove: COMMON_NOISE,
		minLength: 50,
	},
	{
		id: "zenn",
		hosts: /(^|\.)zenn\.dev$/,
		content: [".znc"],
		remove: COMMON_NOISE,
		minLength: 50,
	},
	{
		id: "qiita",
		hosts: /(^|\.)qiita\.com$/,
		content: [".it-MdContent", "[class*='mdContent']", "article"],
		remove: [".code-copy", ...COMMON_NOISE],
		minLength: 50,
	},
	{
		id: "medium",
		hosts: /(^|\.)medium\.com$/,
		// Medium also powers custom domains; the fingerprint catches those.
		fingerprint: (signature) => signature.meta.includes("al:android:app_name=medium"),
		content: ["article section", "article", "[data-testid='storyContent']"],
		remove: ["[data-testid='audioPlayButton']", "[role='separator']", ...COMMON_NOISE],
		minLength: 200,
	},
	{
		id: "substack",
		hosts: /(^|\.)substack\.com$/,
		// Substack's custom domains are far more common than *.substack.com.
		fingerprint: (signature) => signature.classes.has("available-content"),
		content: [".available-content", ".body.markup", ".post-content"],
		remove: [".subscription-widget-wrap", ".button-wrapper", ".paywall", ...COMMON_NOISE],
		minLength: 200,
	},
	{
		id: "note",
		hosts: /(^|\.)note\.com$/,
		content: [".note-common-styles__textnote-body", "[class*='textnote-body']"],
		remove: COMMON_NOISE,
		minLength: 50,
	},
	{
		id: "hatena",
		hosts: /(^|\.)(hatenablog\.com|hatenadiary\.(com|jp)|hateblo\.jp|hatenastaff\.com)$/,
		fingerprint: (signature) => signature.classes.has("hatenablog-entry") || signature.classes.has("hatena-body"),
		content: [".entry-content"],
		remove: [".entry-footer", ".social-buttons", ".hatena-asin-detail", ...COMMON_NOISE],
		minLength: 100,
	},
	{
		id: "wordpress",
		// Deliberately fingerprint-only: WordPress powers a large share of the web on its own
		// domains, so keying off a hostname would cover almost none of it.
		fingerprint: (signature) =>
			signature.generator.includes("wordpress") ||
			signature.classes.has("wp-block-post-content") ||
			signature.classes.has("wp-singular"),
		content: [".wp-block-post-content", ".entry-content", ".post-content", "article .content"],
		remove: [".sharedaddy", ".jp-relatedposts", ".wp-block-comments", "#comments", ...COMMON_NOISE],
		minLength: 150,
	},
	{
		id: "wikipedia",
		hosts: /(^|\.)(wikipedia\.org|wikimedia\.org|wikibooks\.org|wiktionary\.org|wikisource\.org)$/,
		fingerprint: (signature) => signature.classes.has("mw-parser-output"),
		content: [".mw-parser-output", "#mw-content-text"],
		remove: [
			".mw-editsection",
			".navbox",
			".navbox-inner",
			".vertical-navbox",
			".sidebar",
			".side-box",
			".metadata",
			".reflist",
			".refbegin",
			".sistersitebox",
			".ambox",
			".hatnote",
			".shortdescription",
			".mw-jump-link",
			".printfooter",
			".catlinks",
			"#toc",
			".toc",
			"table.mbox-small",
			...COMMON_NOISE,
		],
		minLength: 200,
	},
	{
		id: "reddit",
		hosts: /(^|\.)reddit\.com$/,
		content: ["shreddit-post [slot='text-body']", "[data-test-id='post-content']", ".Post"],
		remove: ["faceplate-tracker[noun='comment_action_bar']", "shreddit-comment-action-row", ...COMMON_NOISE],
		// Reddit renders most of a thread into shadow roots that never reach the serialised HTML,
		// so a weak match here is worse than generic extraction. Decline unless a substantial
		// post body is actually present in the document.
		minLength: 600,
	},
	{
		id: "docusaurus",
		fingerprint: (signature) =>
			signature.classes.has("theme-doc-markdown") || signature.classes.has("docusaurus-mt-lg"),
		content: [".theme-doc-markdown", "article .markdown"],
		remove: [".theme-doc-toc-mobile", ".pagination-nav", ".theme-doc-version-banner", ...COMMON_NOISE],
		minLength: 150,
	},
	{
		id: "vitepress",
		fingerprint: (signature) => signature.classes.has("vp-doc") || signature.classes.has("VPDoc"),
		content: [".vp-doc > div", ".vp-doc", ".VPDoc .content-container"],
		remove: [".VPDocFooter", ".vp-doc-footer", ".header-anchor", ...COMMON_NOISE],
		minLength: 150,
	},
	{
		id: "mkdocs",
		fingerprint: (signature) => signature.classes.has("md-content__inner"),
		content: [".md-content__inner", "[data-md-component='content']"],
		remove: [".md-source-file", ".md-feedback", ".headerlink", ...COMMON_NOISE],
		minLength: 150,
	},
	{
		id: "readthedocs",
		fingerprint: (signature) => signature.classes.has("rst-content"),
		content: [".rst-content", "[role='main']"],
		remove: [".headerlink", ".rst-footer-buttons", ".wy-breadcrumbs", ...COMMON_NOISE],
		minLength: 150,
	},
	{
		id: "gitbook",
		fingerprint: (signature) => signature.classes.has("gitbook-root"),
		content: ["[data-testid='page.contentEditor']", "main article"],
		remove: COMMON_NOISE,
		minLength: 150,
	},
];

export const DECLARATIVE_ADAPTERS: SiteAdapter[] = SPECS.map(defineSelectorAdapter);

/** Exposed for tests and for callers that want to reference one adapter by name. */
export const declarativeAdapterById = (id: string): SiteAdapter | undefined =>
	DECLARATIVE_ADAPTERS.find((adapter) => adapter.id === id);

export type { Hast };
