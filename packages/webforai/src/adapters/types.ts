import type { Element, Nodes as Hast } from "hast";

/**
 * Cheap, precomputed summary of a document.
 *
 * Fingerprints must answer "is this page built with X?" without scanning the tree, because they
 * run for every adapter on every conversion. Collecting the identifying markers in one pass and
 * letting fingerprints do set lookups turns N full CSS traversals into one walk.
 */
export interface PageSignature {
	/** Every distinct class token in the document. */
	classes: ReadonlySet<string>;
	/** Every distinct `id`. */
	ids: ReadonlySet<string>;
	/** Every distinct tag name, lower-cased. */
	tags: ReadonlySet<string>;
	/** Concatenated `content` of `<meta name="generator">`, lower-cased. */
	generator: string;
	/** Concatenated `property`/`name` + `content` pairs of meta tags, lower-cased. */
	meta: string;
}

/** Everything an adapter is given to decide whether, and how, it applies. */
export interface AdapterContext {
	hast: Hast;
	/** Page URL, when known. Adapters that key off the host require it. */
	url?: string;
	lang?: string;
	/**
	 * Precomputed document summary.
	 *
	 * Optional so that adapters remain callable standalone; the pipeline always supplies it.
	 */
	signature?: PageSignature;
	/**
	 * True when the caller owns `hast` and an adapter may mutate it in place.
	 *
	 * Adapters prune their selected container directly, so without this an adapter would damage a
	 * tree the caller still intends to use.
	 */
	owned?: boolean;
}

/**
 * A site-specific extraction strategy.
 *
 * Adapters exist because generic scoring cannot know that a YouTube page keeps its description
 * in an embedded JSON blob, or that a Hacker News thread is laid out with nested tables. They
 * run before the generic extractor and may decline, in which case extraction proceeds normally.
 */
export interface SiteAdapter {
	/** Stable identifier, also used to select an adapter explicitly. */
	id: string;
	/**
	 * Quick applicability test.
	 *
	 * Should be cheap: it runs for every adapter on every conversion. Host checks first, DOM
	 * fingerprints only when the host is unknown.
	 */
	matches: (context: AdapterContext) => boolean;
	/**
	 * Secondary applicability test, run only after no adapter matched on hostname.
	 *
	 * Splitting this from {@link matches} keeps the common path — a known host — free of the
	 * platform-detection work that only matters for self-hosted instances.
	 */
	matchesFingerprint?: (context: AdapterContext) => boolean;
	/**
	 * Produces the content tree, or `undefined` to decline after a closer look.
	 *
	 * Declining is normal and expected — a host match does not guarantee the page is the kind
	 * this adapter understands (a GitHub profile is not a GitHub issue).
	 */
	extract: (context: AdapterContext) => Hast | undefined;
}

/**
 * Declarative adapter definition.
 *
 * Most sites need nothing more than "the content is here, minus these widgets", so they are
 * expressed as data and compiled into a {@link SiteAdapter} by `defineSelectorAdapter`.
 */
export interface SelectorAdapterSpec {
	id: string;
	/** Hostname test, applied to the URL's host. */
	hosts?: RegExp;
	/**
	 * DOM fingerprint, used when no adapter matched on hostname.
	 *
	 * This is what lets one adapter cover every self-hosted instance of a platform: any site
	 * built with the generator matches, not just the flagship domain. Reads only the precomputed
	 * {@link PageSignature}, so it must stay a set lookup rather than a tree query.
	 */
	fingerprint?: (signature: PageSignature) => boolean;
	/** Candidate content containers, best first. The first one that holds text wins. */
	content: string[];
	/** Selectors removed from the chosen container. */
	remove?: string[];
	/** Minimum text length the chosen container must hold before the adapter commits. */
	minLength?: number;
	/** Optional post-processing, e.g. prepending a title or appending metadata. */
	decorate?: (content: Element[], context: AdapterContext) => Hast | undefined;
}
