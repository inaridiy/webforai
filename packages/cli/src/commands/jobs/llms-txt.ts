/**
 * llms.txt / llms-full.txt rendering for crawl output, per https://llmstxt.org:
 *
 * ```md
 * # Site title
 *
 * > One-line summary
 *
 * ## Section
 *
 * - [Page title](https://url): description
 * ```
 *
 * `llms-full.txt` is the companion convention: every page's Markdown, concatenated, so an
 * agent can load a whole site in one read.
 */

export interface LlmsPage {
	url: string;
	markdown: string;
	metadata: Record<string, unknown>;
}

export interface LlmsSite {
	/** The crawl's seed URL; its page supplies the site title and summary when present. */
	seedUrl: string;
	pages: readonly LlmsPage[];
}

const str = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() !== "" ? value.trim().replace(/\s+/gu, " ") : undefined;

const firstHeading = (markdown: string): string | undefined => {
	const match = /^#{1,2}[ \t]+(.+?)[ \t#]*$/mu.exec(markdown);
	return match ? str(match[1]) : undefined;
};

/** `[`/`]` would end the link text early; escape them instead of dropping them. */
const escapeLinkText = (text: string): string => text.replace(/([\\[\]])/gu, "\\$1");

const pageTitle = (page: LlmsPage): string =>
	str(page.metadata.title) ?? firstHeading(page.markdown) ?? (new URL(page.url).pathname || page.url);

const normalizeUrl = (value: string): string => {
	const url = new URL(value);
	url.hash = "";
	return url.href;
};

const findSeed = (site: LlmsSite): LlmsPage | undefined => {
	const seed = normalizeUrl(site.seedUrl);
	return site.pages.find((page) => normalizeUrl(page.url) === seed);
};

const siteTitle = (site: LlmsSite, seed: LlmsPage | undefined): string =>
	str(seed?.metadata.siteName) ??
	str(site.pages.find((page) => str(page.metadata.siteName))?.metadata.siteName) ??
	str(seed?.metadata.title) ??
	new URL(site.seedUrl).host;

/**
 * Sections follow the first directory of the path (`/docs/...` and `/docs/` → "Docs");
 * top-level pages (`/`, `/about`) form the leading "Pages" section.
 */
const sectionOf = (pageUrl: string): string => {
	const { pathname } = new URL(pageUrl);
	const segments = pathname.split("/").filter(Boolean);
	const first = segments[0];
	if (!first || (segments.length === 1 && !pathname.endsWith("/"))) {
		return "";
	}
	let decoded = first;
	try {
		decoded = decodeURIComponent(first);
	} catch {
		// keep the raw segment
	}
	const words = decoded.replace(/[-_]+/gu, " ").trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Pages in output order: grouped by section (top level first, then A→Z), URL order inside. */
export const orderPages = (pages: readonly LlmsPage[]): { section: string; pages: LlmsPage[] }[] => {
	const groups = new Map<string, LlmsPage[]>();
	for (const page of [...pages].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))) {
		const section = sectionOf(page.url);
		groups.set(section, [...(groups.get(section) ?? []), page]);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
		.map(([section, grouped]) => ({ section, pages: grouped }));
};

export const renderLlmsTxt = (site: LlmsSite): string => {
	const seed = findSeed(site);
	const lines = [`# ${siteTitle(site, seed)}`, ""];
	const summary = str(seed?.metadata.description);
	if (summary) {
		lines.push(`> ${summary}`, "");
	}
	for (const { section, pages } of orderPages(site.pages)) {
		lines.push(`## ${section || "Pages"}`, "");
		for (const page of pages) {
			const description = str(page.metadata.description);
			const link = `- [${escapeLinkText(pageTitle(page))}](${page.url})`;
			lines.push(description ? `${link}: ${description}` : link);
		}
		lines.push("");
	}
	return `${lines.join("\n").trimEnd()}\n`;
};

export const renderLlmsFullTxt = (site: LlmsSite): string => {
	const seed = findSeed(site);
	const parts = [`# ${siteTitle(site, seed)}`];
	for (const { pages } of orderPages(site.pages)) {
		for (const page of pages) {
			const body = page.markdown.trim();
			// Pages without their own heading get one, so page boundaries stay visible.
			const heading = /^#[ \t]/u.test(body) ? "" : `# ${pageTitle(page)}\n\n`;
			parts.push(`${heading}Source: ${page.url}\n\n${body}`);
		}
	}
	return `${parts.join("\n\n---\n\n")}\n`;
};
