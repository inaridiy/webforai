export const USER_AGENT =
	"mozilla/5.0 (windows nt 10.0; win64; x64) applewebkit/537.36 (khtml, like gecko) chrome/125.0.0.0 safari/537.36";

/**
 * Useful function for load the HTML of a URL using the Fetch API.
 * **Not recommended** for use in production environments.
 * @param url - The URL to load.
 * @returns The HTML content of the URL.
 */
export const loadHtml = async (url: string) => {
	const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
	return response.text();
};
