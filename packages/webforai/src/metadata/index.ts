/**
 * Page metadata extraction.
 *
 * Reads the descriptive fields a page publishes about itself — title, author, dates, canonical
 * URL — from the several places publishers put them. Sources are consulted in order of
 * reliability: explicit structured data first, then social-card meta tags, then ordinary meta
 * tags, then the document itself.
 *
 * This must run against the *original* document. Extraction discards `<head>`, so calling it on
 * an extracted tree returns almost nothing.
 */

import type { Element, Nodes as Hast } from "hast";

import { collectElements, findElement, isElement, stringProperty, walk } from "../utils/hast-fast";

export interface PageMetadata {
	title?: string;
	description?: string;
	author?: string;
	/** ISO-8601 publication date, as published by the page. Not re-parsed or normalised. */
	published?: string;
	modified?: string;
	siteName?: string;
	canonicalUrl?: string;
	lang?: string;
	image?: string;
	/** Open Graph object type, e.g. `article` or `website`. */
	type?: string;
}

/** Collects `<meta>` content, keyed by the lower-cased `name`/`property`/`itemprop`. */
const readMetaTags = (tree: Hast): Map<string, string> => {
	const tags = new Map<string, string>();

	for (const meta of collectElements(tree, (element) => element.tagName === "meta")) {
		const key = stringProperty(meta, "property") ?? stringProperty(meta, "name") ?? stringProperty(meta, "itemprop");
		const content = stringProperty(meta, "content");
		if (!(key && content)) {
			continue;
		}
		const normalized = key.toLowerCase();
		// First writer wins: pages sometimes repeat a property, and the first is the canonical one.
		if (!tags.has(normalized)) {
			tags.set(normalized, content);
		}
	}

	return tags;
};

/**
 * Parses every JSON-LD block and returns the entries, flattened.
 *
 * `@graph` containers and top-level arrays are both common, so the shape is normalised before
 * any field is read.
 */
export const readJsonLd = (tree: Hast): Record<string, unknown>[] => {
	const entries: Record<string, unknown>[] = [];

	for (const script of collectElements(tree, (element) => element.tagName === "script")) {
		const type = stringProperty(script, "type");
		if (type?.toLowerCase() !== "application/ld+json") {
			continue;
		}

		const source = script.children
			.map((child) => (child.type === "text" ? child.value : ""))
			.join("")
			.trim();
		if (source.length === 0) {
			continue;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(source);
		} catch {
			continue; // malformed structured data is common and never worth failing over
		}

		for (const entry of flattenJsonLd(parsed)) {
			entries.push(entry);
		}
	}

	return entries;
};

const flattenJsonLd = (value: unknown): Record<string, unknown>[] => {
	if (Array.isArray(value)) {
		return value.flatMap(flattenJsonLd);
	}
	if (typeof value !== "object" || value === null) {
		return [];
	}

	const record = value as Record<string, unknown>;
	const graph = record["@graph"];
	if (graph) {
		return flattenJsonLd(graph);
	}
	return [record];
};

/** JSON-LD types that describe the page's own content. */
const ARTICLE_TYPES = new Set([
	"article",
	"newsarticle",
	"blogposting",
	"techarticle",
	"scholarlyarticle",
	"report",
	"webpage",
]);

const jsonLdType = (entry: Record<string, unknown>): string[] => {
	const type = entry["@type"];
	if (typeof type === "string") {
		return [type.toLowerCase()];
	}
	if (Array.isArray(type)) {
		return type.filter((value): value is string => typeof value === "string").map((value) => value.toLowerCase());
	}
	return [];
};

/** Reads a name out of the several shapes schema.org allows for a person or organisation. */
const readName = (value: unknown): string | undefined => {
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			const name = readName(entry);
			if (name) {
				return name;
			}
		}
		return undefined;
	}
	if (typeof value === "object" && value !== null) {
		const name = (value as Record<string, unknown>).name;
		return typeof name === "string" ? name : undefined;
	}
	return undefined;
};

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

/** Longer than this and the value is a description, not a title. */
const MAX_TITLE_LENGTH = 160;

/** Accepts a title candidate, rejecting values that are really descriptions. */
const asTitle = (value: string | undefined): string | undefined => {
	const cleaned = clean(value);
	return cleaned && cleaned.length <= MAX_TITLE_LENGTH ? cleaned : undefined;
};

/** Collapses runs of whitespace, which meta tags and headings both carry liberally. */
const clean = (value: string | undefined): string | undefined => {
	if (value === undefined) {
		return undefined;
	}
	const trimmed = value.replace(/\s+/g, " ").trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

const documentTitle = (tree: Hast): string | undefined => {
	const title = findElement(tree, (element) => element.tagName === "title");
	if (!title) {
		return undefined;
	}
	return title.children.map((child) => (child.type === "text" ? child.value : "")).join("");
};

const firstHeading = (tree: Hast): string | undefined => {
	const heading = findElement(tree, (element) => element.tagName === "h1");
	if (!heading) {
		return undefined;
	}
	let text = "";
	walk(heading, (node) => {
		if (node.type === "text") {
			text += node.value;
		}
	});
	return text;
};

const linkHref = (tree: Hast, rel: string): string | undefined => {
	const link = findElement(
		tree,
		(element) => element.tagName === "link" && (stringProperty(element, "rel") ?? "").toLowerCase().includes(rel),
	);
	return link ? stringProperty(link, "href") : undefined;
};

/**
 * Reads the document language.
 *
 * Falls back to the first element that declares one, because parsing HTML as a fragment discards
 * the `<html>` element that would normally carry it.
 */
const documentLang = (tree: Hast): string | undefined => {
	const html = findElement(tree, (element) => element.tagName === "html");
	if (html) {
		const declared = stringProperty(html, "lang") ?? stringProperty(html, "xml:lang");
		if (declared) {
			return declared;
		}
	}

	if (isElement(tree)) {
		const own = stringProperty(tree as Element, "lang");
		if (own) {
			return own;
		}
	}

	const tagged = findElement(tree, (element) => Boolean(stringProperty(element, "lang")));
	return tagged ? stringProperty(tagged, "lang") : undefined;
};

/**
 * Extracts what the page says about itself.
 *
 * @param tree - The **original** document, before extraction removed `<head>`.
 * @returns Whatever could be determined; every field is optional.
 */
export const extractMetadata = (tree: Hast): PageMetadata => {
	const meta = readMetaTags(tree);
	const jsonLd = readJsonLd(tree);
	const article = jsonLd.find((entry) => jsonLdType(entry).some((type) => ARTICLE_TYPES.has(type))) ?? jsonLd[0];

	const get = (...keys: string[]): string | undefined => {
		for (const key of keys) {
			const value = meta.get(key);
			if (value) {
				return value;
			}
		}
		return undefined;
	};

	// `og:title` is consulted before JSON-LD `headline` because several publishers — Wikipedia
	// among them — put a descriptive sentence in `headline`, which then reads as the page title.
	// Anything sentence-length is rejected outright.
	const title =
		asTitle(get("og:title", "twitter:title")) ??
		asTitle(asString(article?.headline)) ??
		asTitle(asString(article?.name)) ??
		asTitle(documentTitle(tree)) ??
		asTitle(firstHeading(tree));

	return {
		title,
		description:
			clean(get("og:description", "twitter:description", "description")) ?? clean(asString(article?.description)),
		author: clean(readName(article?.author)) ?? clean(get("author", "article:author", "twitter:creator")),
		published: clean(asString(article?.datePublished)) ?? clean(get("article:published_time", "date", "pubdate")),
		modified: clean(asString(article?.dateModified)) ?? clean(get("article:modified_time", "og:updated_time")),
		siteName: clean(get("og:site_name", "application-name")) ?? clean(readName(article?.publisher)),
		canonicalUrl: clean(linkHref(tree, "canonical")) ?? clean(get("og:url", "twitter:url")),
		lang: clean(documentLang(tree)),
		image: clean(get("og:image", "twitter:image", "twitter:image:src")),
		type: clean(get("og:type")),
	};
};

/** Escapes a value for a double-quoted YAML scalar. */
const yamlString = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Renders metadata as a YAML front-matter block.
 *
 * Returns an empty string when nothing is known, so callers can concatenate unconditionally
 * without producing an empty `---\n---` header.
 */
export const toFrontmatter = (metadata: PageMetadata): string => {
	const lines: string[] = [];

	for (const [key, value] of Object.entries(metadata)) {
		if (typeof value === "string" && value.length > 0) {
			lines.push(`${key}: ${yamlString(value)}`);
		}
	}

	if (lines.length === 0) {
		return "";
	}

	return `---\n${lines.join("\n")}\n---\n\n`;
};
