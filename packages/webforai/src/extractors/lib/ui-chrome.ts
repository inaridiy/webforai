/**
 * Boilerplate detection by visible text.
 *
 * Class and id heuristics assume readable class names. Component frameworks that hash their
 * classes defeat them entirely, which is why blinded evaluation kept flagging leftovers like
 * "Copy page", "Was this page helpful? Yes No" and "Edit this page" on documentation sites whose
 * markup carries no usable names at all. Matching what the element actually *says* works
 * regardless of how it was built — the technique defuddle relies on.
 *
 * The rule is deliberately narrow. An element is chrome only when its **entire** text is one of
 * these phrases, so prose that merely mentions "share" or "subscribe" is untouched.
 */

/**
 * Whole-element texts that are page furniture rather than content.
 *
 * Normalised before comparison: lower-cased, punctuation stripped, whitespace collapsed.
 */
const UI_PHRASES = new Set([
	// Documentation and article controls
	"copy",
	"copy page",
	"copy link",
	"copy code",
	"copied",
	"edit this page",
	"edit on github",
	"on this page",
	"in this article",
	"table of contents",
	"contents",
	"print",
	"print this page",
	"back to top",
	"scroll to top",
	"skip to content",
	"skip to main content",
	"permalink",
	"anchor",
	// Feedback widgets
	"was this page helpful",
	"was this helpful",
	"was this article helpful",
	"yes no",
	"feedback",
	"send feedback",
	"report an issue",
	"rate this page",
	// Sharing and subscription
	"share",
	"share this",
	"share this article",
	"share on twitter",
	"share on facebook",
	"subscribe",
	"sign up",
	"sign in",
	"log in",
	"login",
	"newsletter",
	// Advertising and promotion
	"advertisement",
	"advertisements",
	"sponsored",
	"sponsored content",
	"promoted",
	// Navigation affordances
	"read more",
	"show more",
	"show less",
	"see more",
	"load more",
	"previous",
	"next",
	"previous page",
	"next page",
	"menu",
	"close",
	"search",
	// Japanese equivalents
	"目次",
	"広告",
	"シェア",
	"共有",
	"この記事をシェア",
	"続きを読む",
	"もっと見る",
	"関連記事",
	"スポンサーリンク",
	"ページの先頭へ",
	"トップへ戻る",
	"前へ",
	"次へ",
	"閉じる",
	"検索",
	"ログイン",
	"会員登録",
]);

/**
 * Longest text considered for a phrase match.
 *
 * A cap is what keeps this safe: real prose is longer than any UI label, so anything above the
 * limit is never tested and can never be removed by accident.
 */
const MAX_PHRASE_LENGTH = 40;

/**
 * Normalises text for comparison.
 *
 * Punctuation and case vary between sites for the same control ("Was this page helpful?" versus
 * "Was this page helpful"), and widgets concatenate their parts without spaces.
 */
const normalize = (text: string): string =>
	text
		.toLowerCase()
		.replace(/[?!.,:;·・…"'“”‘’()[\]{}<>|/\\—–-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

/**
 * True when an element's entire visible text is a user-interface label.
 *
 * @param text - The element's complete text content.
 */
export const isUiChromeText = (text: string): boolean => {
	if (text.length === 0 || text.length > MAX_PHRASE_LENGTH) {
		return false;
	}

	const normalized = normalize(text);
	if (normalized.length === 0) {
		return false;
	}

	return UI_PHRASES.has(normalized);
};

/**
 * Opening phrases of the stand-in a consent manager renders where a third-party embed was.
 *
 * The embed itself never loaded, so the placeholder is all that remains — and it is written as a
 * full sentence ("This content isn't visible due to your cookie preferences…"), which is too long
 * for {@link UI_PHRASES} and carries no class name a hashing framework leaves readable. Anchored
 * at the start of the element's text so prose that merely discusses cookies is untouched.
 */
const CONSENT_PLACEHOLDER =
	/^(this content (isn['’]?t|is not) (visible|available) (due to|because of) your (cookie|privacy) (preferences|settings)|we need your (consent|permission) to load|to (view|see|load) this (content|embed|video|post)[, ]+(please )?(enable|accept|allow|update)|(please )?(accept|allow|enable) (all |marketing |functional )?cookies to (view|see|load|watch)|このコンテンツを表示するには.{0,30}(cookie|クッキー|同意|許可))/i;

/** Longest text a consent placeholder may have; an article paragraph is never tested. */
export const MAX_CONSENT_PLACEHOLDER_LENGTH = 400;

/**
 * True when an element's entire text is a consent manager's embed placeholder.
 *
 * @param text - The element's complete text content.
 */
export const isConsentPlaceholderText = (text: string): boolean =>
	text.length <= MAX_CONSENT_PLACEHOLDER_LENGTH && CONSENT_PLACEHOLDER.test(text.trimStart());
