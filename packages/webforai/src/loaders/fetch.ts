import { extractMetaRefresh } from "../extract-meta-refresh";

export const USER_AGENT =
	"mozilla/5.0 (windows nt 10.0; win64; x64) applewebkit/537.36 (khtml, like gecko) chrome/125.0.0.0 safari/537.36";

/** Some sites chain language/hosting stubs; anything deeper than this is a loop. */
const MAX_META_REFRESH_HOPS = 3;

/**
 * Useful function for load the HTML of a URL using the Fetch API.
 * **Not recommended** for use in production environments.
 *
 * Meta-refresh redirects (an HTTP 200 stub whose `<meta http-equiv="refresh">` sends the
 * browser elsewhere) are followed like ordinary redirects, up to a small hop cap.
 *
 * @param url - The URL to load.
 * @param userAgent - The user agent to use. Default is a Chrome user agent.
 * @returns The HTML content of the URL.
 */
export const loadHtml = async (url: string, userAgent = USER_AGENT) => {
	let current = url;
	let html = "";
	for (let hop = 0; hop <= MAX_META_REFRESH_HOPS; hop++) {
		const response = await fetch(current, { headers: { "User-Agent": userAgent } });
		html = await response.text();
		// `response.url` reflects HTTP redirects the fetch already followed; relative meta
		// targets must resolve against it, not the URL we asked for.
		const refresh = extractMetaRefresh(html, response.url || current);
		if (!refresh) {
			break;
		}
		current = refresh.url;
	}
	return html;
};
