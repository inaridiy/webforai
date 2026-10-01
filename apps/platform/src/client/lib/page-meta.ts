import { useEffect } from "react";

/**
 * Per-route document metadata. `App` sets `document.title` from it on every navigation, and
 * `scripts/prerender.ts` writes the same title, description and canonical URL into each
 * prerendered HTML file, so crawlers and the live page agree.
 */

export const SITE_NAME = "webforai platform";
/** The landing page's title; must match `<title>` in index.html. */
export const DEFAULT_TITLE = "webforai platform — any web page as clean Markdown";

export type PageMeta = { title: string; description?: string };

const PAGE_META: Record<string, PageMeta> = {
	"/": { title: DEFAULT_TITLE },
	"/login": { title: "Sign in" },
	"/signup": { title: "Create account" },
	"/dashboard": { title: "Dashboard" },
	"/playground": { title: "Playground" },
	"/share": { title: "Open shared page" },
	"/terms": {
		title: "Terms of Service",
		description:
			"Terms of Service for webforai platform, the hosted API that turns web pages into Markdown: accounts, credits and billing, limits, acceptable use and liability.",
	},
	"/privacy": {
		title: "Privacy Policy",
		description:
			"How webforai platform collects, uses, stores and transfers personal information, including service providers, retention periods and your rights.",
	},
	"/commerce": {
		title: "特定商取引法に基づく表記",
		description: "webforai platform の特定商取引法に基づく表記（販売事業者、販売価格、支払方法、提供時期、解約等）。",
	},
};

const NOT_FOUND: PageMeta = { title: "Page not found" };

export const pageMeta = (path: string): PageMeta => PAGE_META[path] ?? NOT_FOUND;

/** "Page — webforai platform"; the landing page keeps its full marketing title. */
export const documentTitle = (path: string): string => {
	const { title } = pageMeta(path);
	return title === DEFAULT_TITLE ? title : `${title} — ${SITE_NAME}`;
};

export const useDocumentTitle = (path: string): void => {
	useEffect(() => {
		document.title = documentTitle(path);
	}, [path]);
};
