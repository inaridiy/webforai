/**
 * Heuristic detection of HTML documents that carry no readable content because the page is
 * built client-side (SPA shells), gated behind an anti-bot interstitial, or simply empty.
 *
 * Converting such a document yields a markdown body that is at best the `<title>` — the
 * caller almost always wants to re-fetch with a JavaScript-rendering engine instead. The
 * verdict is advisory: thresholds are tuned so that short-but-real static pages (an
 * example.com-sized document) are NOT flagged.
 *
 * Expects a full document; fragments without `<body>` are judged as a whole and tiny
 * fragments will read as `empty-body`.
 */

export type ClientShellReason = "empty-body" | "spa-shell" | "noscript-only" | "anti-bot-challenge";

export interface ClientShellVerdict {
	isShell: boolean;
	reason?: ClientShellReason;
	/** Characters of visible body text after stripping markup — what a conversion could use. */
	visibleTextLength: number;
}

/** Body text at or above this length is always treated as real content. */
export const SHELL_SUSPICION_THRESHOLD = 300;
/** Below this length the document is a shell even without a framework marker. */
export const SHELL_EMPTY_THRESHOLD = 50;

const BODY_PATTERN = /<body[^>]*>([\s\S]*?)<\/body>/i;
const HEAD_PATTERN = /<head[^>]*>[\s\S]*?<\/head>/gi;
const NOSCRIPT_PATTERN = /<noscript[^>]*>([\s\S]*?)<\/noscript>/gi;
const INVISIBLE_ELEMENT_PATTERN = /<(script|style|template|svg|noscript)[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const TAG_PATTERN = /<[^>]+>/g;

/**
 * Mount points the major client-side frameworks render into. Presence alone is not a
 * verdict — SSR'd apps keep the same ids — it only matters once the body text is thin.
 */
const MOUNT_POINT_PATTERN =
	/<[a-z][^>]*\sid=["'](?:root|app|__next|___gatsby|__nuxt|q-app|svelte|react-root)["']|<app-root[\s>]|\sdata-reactroot[\s>=]/i;

/** Fingerprints of bot-challenge interstitials (Cloudflare, Imperva, PerimeterX, DataDome). */
const CHALLENGE_PATTERN =
	/cf-chl|challenge-platform|cf_chl_opt|just a moment|attention required|checking your browser|_incapsula_|px-captcha|datadome/i;

const ENTITIES: Record<string, string> = {
	"&nbsp;": " ",
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
};

const visibleTextOf = (markup: string): string =>
	markup
		.replace(COMMENT_PATTERN, " ")
		.replace(INVISIBLE_ELEMENT_PATTERN, " ")
		.replace(TAG_PATTERN, " ")
		.replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? " ")
		.replace(/\s+/g, " ")
		.trim();

const noscriptMentionsJavascript = (html: string): boolean => {
	for (const match of html.matchAll(NOSCRIPT_PATTERN)) {
		if (/javascript/i.test(match[1] ?? "")) {
			return true;
		}
	}
	return false;
};

export const detectClientShell = (html: string): ClientShellVerdict => {
	const body = BODY_PATTERN.exec(html)?.[1] ?? html.replace(HEAD_PATTERN, " ");
	const visibleTextLength = visibleTextOf(body).length;

	if (visibleTextLength >= SHELL_SUSPICION_THRESHOLD) {
		return { isShell: false, visibleTextLength };
	}
	if (CHALLENGE_PATTERN.test(html)) {
		return { isShell: true, reason: "anti-bot-challenge", visibleTextLength };
	}
	if (MOUNT_POINT_PATTERN.test(body)) {
		return { isShell: true, reason: "spa-shell", visibleTextLength };
	}
	if (noscriptMentionsJavascript(html)) {
		return { isShell: true, reason: "noscript-only", visibleTextLength };
	}
	if (visibleTextLength < SHELL_EMPTY_THRESHOLD) {
		return { isShell: true, reason: "empty-body", visibleTextLength };
	}
	return { isShell: false, visibleTextLength };
};
