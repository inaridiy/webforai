import type { Nodes as Hast } from "hast";

import { stripNonContent } from "../extractors/lib/sanitize";
import { MetricsCollector, cloneHast } from "../utils/hast-fast";
import { buildPageSignature, resolveAdapterByFingerprint, resolveAdapterByHost } from "./registry";
import { DECLARATIVE_ADAPTERS } from "./sites/declarative";
import { hackernewsAdapter } from "./sites/hackernews";
import { youtubeAdapter } from "./sites/youtube";
import type { AdapterContext, SiteAdapter } from "./types";

/**
 * Built-in adapters, in priority order.
 *
 * Host-specific adapters come first so that a site with its own entry is not claimed by a
 * generic documentation-framework fingerprint that would also match it.
 */
export const BUILTIN_ADAPTERS: SiteAdapter[] = [youtubeAdapter, hackernewsAdapter, ...DECLARATIVE_ADAPTERS];

export const adapterById = (id: string): SiteAdapter | undefined =>
	BUILTIN_ADAPTERS.find((adapter) => adapter.id === id);

/** Text an adapter must produce before its result is preferred over generic extraction. */
const MIN_ADAPTER_TEXT = 40;

/**
 * Runs the first adapter that claims the page.
 *
 * Returns `undefined` when no adapter applies, or when the one that did produced too little to
 * be trusted — in both cases the caller should fall back to generic extraction. An adapter
 * silently returning a near-empty tree is the main way site-specific code goes wrong as sites
 * are redesigned, so the result is always size-checked rather than taken on faith.
 */
export const runAdapters = (context: AdapterContext, adapters: SiteAdapter[] = BUILTIN_ADAPTERS): Hast | undefined => {
	// Host matching is a string test, so try it before paying for a document traversal. Only when
	// no host matched is the signature built and the platform fingerprints consulted.
	let matched = resolveAdapterByHost(context, adapters);
	let withSignature = context;

	if (!matched) {
		withSignature = { ...context, signature: context.signature ?? buildPageSignature(context.hast) };
		matched = resolveAdapterByFingerprint(withSignature, adapters);
	}

	const adapter = matched;
	if (!adapter) {
		return undefined;
	}

	// Adapters prune their selected container in place. Cloning happens only once an adapter has
	// actually claimed the page, so pages that fall through to generic extraction pay nothing.
	const target: AdapterContext = withSignature.owned
		? withSignature
		: { ...withSignature, hast: cloneHast(withSignature.hast), owned: true };

	let extracted: Hast | undefined;
	try {
		extracted = adapter.extract(target);
	} catch {
		return undefined;
	}

	if (!extracted) {
		return undefined;
	}

	// Adapters select a container; they do not sanitise it. Without this, comments, metadata
	// elements and invisible nodes reach the output — MediaWiki's parser-cache comment block was
	// showing up verbatim at the end of every Wikipedia conversion.
	stripNonContent(extracted);

	return new MetricsCollector().textLength(extracted) >= MIN_ADAPTER_TEXT ? extracted : undefined;
};

// biome-ignore lint/performance/noBarrelFile: module index
export {
	buildPageSignature,
	defineSelectorAdapter,
	removeAll,
	resolveAdapter,
	selectFirst,
} from "./registry";
export { DECLARATIVE_ADAPTERS } from "./sites/declarative";
export { hackernewsAdapter } from "./sites/hackernews";
export { youtubeAdapter, youtubeCaptionTracks, type CaptionTrack } from "./sites/youtube";
export type { AdapterContext, PageSignature, SelectorAdapterSpec, SiteAdapter } from "./types";
