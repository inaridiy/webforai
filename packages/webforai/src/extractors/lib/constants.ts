/**
 * Shared vocabulary for the content extractors.
 *
 * The regular expressions descend from @mozilla/readability (Apache-2.0, original copyright
 * (c) 2010 Arc90 Inc — see https://github.com/mozilla/readability). They have been extended for
 * modern component-framework class names, Japanese publishers, cookie/consent banners and the
 * newsletter/paywall furniture that post-dates the original heuristics.
 */

export const REGEXPS = {
	/**
	 * Containers that almost never hold the article body.
	 *
	 * Note the words that are deliberately *absent*. `header` and `footer` match the heading
	 * anchors and article furniture that documentation generators emit (`<a class="header">`,
	 * `class="post-header"`), so matching them here deletes the page's headings. The landmark
	 * versions of those elements are handled structurally instead.
	 */
	unlikelyCandidates:
		/-ad-|ai2html|banner|breadcrumb|combx|comment(?!ary)|community|cover-wrap|disqus|gdpr|legends|menu|related|remark|replies|rss|shoutbox|sidebar|site-index|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote|speechify-ignore|avatar|subscribe|newsletter|paywall|consent|cookie|toolbar|masthead|promo|share|sharing|widget|tooltip|dropdown|modal|overlay|backdrop|carousel|announcement|notification|toast|skip-link|screen-reader|visually-hidden|sr-only/i,
	/** Rescues containers whose class merely happens to contain an unlikely substring. */
	okMaybeItsaCandidate: /and|article|body|column|content|main|shadow|code|post|entry|story|markdown|prose|doc/i,
	/** Very high-confidence boilerplate, not rescued by the clause above. */
	stronglyUnlikely:
		/^(nav|navbar|breadcrumbs?|cookie-?(banner|consent|notice)|consent-?(banner|manager)|skip-?link|site-?header|site-?footer|global-?(header|footer)|social-?(share|links?)|share-?(bar|buttons?)|related-?(posts?|articles?)|newsletter-?(signup|form)|comment-?(form|list)|toc-?sidebar)$/i,
	/** Class/id fragments that mark real article content. */
	positive:
		/article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story|markdown|prose|documentation|doc-?content|readme/i,
	/** Class/id fragments that mark furniture. */
	negative:
		/-ad-|hidden|^hid$| hid$|^hid |banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget|toolbar|nav|menu|cookie|consent|subscribe|newsletter|popup|modal|overlay|breadcrumb|pagination|social/i,
	/** Placeholder imagery that should never reach the output. */
	hidden: /fallback-image/i,
	byline: /byline|author|dateline|writtenby|p-author|c-author|post-meta|entry-meta/i,
	/** Wiki/CMS chrome that generic scoring alone tends to keep. */
	specialUnlikelyCandidates: /frb-|uls-menu|language-link|mw-editsection|noprint|navbox|metadata|catlinks|printfooter/i,
} as const;

/** Never carry any semantic content into Markdown. */
export const NON_CONTENT_TAGS = new Set([
	"script",
	"style",
	"link",
	"meta",
	"noscript",
	"template",
	"base",
	"param",
	"source",
	"track",
	"title",
]);

/**
 * Structural chrome removed before scoring.
 *
 * `<header>` and `<footer>` are deliberately absent. They are landmarks only when they sit at
 * the top level of the document; nested inside content they are section furniture, and every
 * major documentation generator wraps section headings in one. Removing them wholesale deletes
 * the article's headings. The top-level case is caught by the `banner`/`contentinfo` roles in
 * {@link UNLIKELY_ROLES} and by {@link isTopLevelLandmark}.
 */
export const CHROME_TAGS = new Set(["nav", "aside", "dialog", "menu"]);

/** Landmark tags that are chrome at the top level of a document but content when nested. */
export const CONTEXTUAL_LANDMARK_TAGS = new Set(["header", "footer"]);

/**
 * Class names that, on their own, mean an element is not displayed.
 *
 * Matched as whole class tokens, never as substrings. Tailwind alone ships `overflow-hidden`,
 * `group-data-[collapsible=icon]:hidden` and a dozen similar utilities; a substring match on
 * "hidden" deletes most of a modern component-framework page.
 */
export const HIDDEN_CLASS_NAMES = new Set([
	"hidden",
	"invisible",
	"is-hidden",
	"d-none",
	"display-none",
	"hide",
	"is-invisible",
]);

/**
 * Responsive utilities that re-display an element at a wider breakpoint.
 *
 * `class="hidden md:block"` is hidden on a phone and visible on a desktop. Since extraction
 * models a desktop reader, the presence of any such override cancels the hidden classification.
 */
export const RESPONSIVE_DISPLAY_OVERRIDE =
	/^(sm|md|lg|xl|2xl|print):(block|flex|grid|inline|inline-block|inline-flex|table|contents|list-item)$/;

/** ARIA roles whose subtrees are chrome rather than content. */
export const UNLIKELY_ROLES = new Set([
	"menu",
	"menubar",
	"menuitem",
	"complementary",
	"navigation",
	"alert",
	"alertdialog",
	"dialog",
	"banner",
	"contentinfo",
	"search",
	"searchbox",
	"toolbar",
	"tablist",
	"tooltip",
	// `presentation` is deliberately absent. It marks an element as decorative *structure* — a
	// layout table, a wrapper — while the content inside it is usually real. Treating it as
	// chrome deletes article text.
]);

/** Roles that positively mark the content region. */
export const CONTENT_ROLES = new Set(["main", "article", "document"]);

/** Elements scored directly during candidate discovery. */
export const SCOREABLE_TAGS = new Set(["p", "td", "pre", "blockquote", "dd", "li", "figure", "section", "div"]);

/** Block containers that can be promoted to a candidate. */
export const CANDIDATE_TAGS = new Set([
	"div",
	"section",
	"article",
	"main",
	"td",
	"pre",
	"blockquote",
	"form",
	"ul",
	"ol",
	"dl",
]);

/** Tags that count as real content even when they hold little text. */
export const EMBEDDED_CONTENT_TAGS = new Set([
	"img",
	"picture",
	"video",
	"audio",
	"iframe",
	"embed",
	"object",
	"svg",
	// Formulae hold no text of their own, so an empty-wrapper rule would otherwise delete them.
	"math",
	"mjx-container",
	"canvas",
]);

/** Tags whose emptiness means they should be dropped. */
export const DROP_WHEN_EMPTY_TAGS = new Set([
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"li",
	"td",
	"th",
	"blockquote",
	"figcaption",
	"dd",
	"dt",
	"a",
	"span",
	"div",
	"section",
	"article",
]);

/**
 * Minimum characters a candidate must hold before it can beat the whole-document fallback.
 *
 * Japanese and Chinese pack far more meaning per character than European languages, so a flat
 * threshold either rejects real CJK articles or lets English navigation blocks through.
 */
export const MIN_CONTENT_LENGTH: Record<string, number> = {
	ja: 140,
	zh: 140,
	ko: 160,
	th: 160,
	default: 400,
};

export const minContentLength = (lang: string | undefined): number => {
	if (!lang) {
		return MIN_CONTENT_LENGTH.default;
	}
	const primary = lang.toLowerCase().split("-")[0];
	return MIN_CONTENT_LENGTH[primary] ?? MIN_CONTENT_LENGTH.default;
};
