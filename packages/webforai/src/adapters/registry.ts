import type { Element, Nodes as Hast } from "hast";
import { select, selectAll } from "hast-util-select";

import { MetricsCollector, classList, isElement, pruneInPlace, stringProperty, walk } from "../utils/hast-fast";
import type { AdapterContext, PageSignature, SelectorAdapterSpec, SiteAdapter } from "./types";

const EMPTY_SIGNATURE: PageSignature = {
	classes: new Set(),
	ids: new Set(),
	tags: new Set(),
	generator: "",
	meta: "",
};

/**
 * Builds a document summary in a single traversal.
 *
 * Called once per conversion and shared by every fingerprint, replacing what would otherwise be
 * one full CSS-selector scan per adapter.
 */
export const buildPageSignature = (root: Hast): PageSignature => {
	const classes = new Set<string>();
	const ids = new Set<string>();
	const tags = new Set<string>();
	const generatorParts: string[] = [];
	const metaParts: string[] = [];

	walk(root, (node) => {
		if (!isElement(node)) {
			return;
		}

		tags.add(node.tagName);

		for (const name of classList(node)) {
			classes.add(name);
		}

		const id = stringProperty(node, "id");
		if (id) {
			ids.add(id);
		}

		if (node.tagName === "meta") {
			const key = stringProperty(node, "name") ?? stringProperty(node, "property") ?? "";
			const content = stringProperty(node, "content") ?? "";
			metaParts.push(`${key}=${content}`);
			if (key.toLowerCase() === "generator") {
				generatorParts.push(content);
			}
		}
	});

	return {
		classes,
		ids,
		tags,
		generator: generatorParts.join(" ").toLowerCase(),
		meta: metaParts.join("\n").toLowerCase(),
	};
};

/** Default minimum text a declarative adapter's container must hold. */
const DEFAULT_MIN_LENGTH = 40;

const hostOf = (url: string | undefined): string | undefined => {
	if (!url) {
		return undefined;
	}
	try {
		return new URL(url).hostname;
	} catch {
		return undefined;
	}
};

/**
 * Compiles a declarative spec into a runnable adapter.
 *
 * The compiled adapter clones nothing: `extract` is called with a tree the pipeline already owns,
 * and removal happens in place on the selected container.
 */
export const defineSelectorAdapter = (spec: SelectorAdapterSpec): SiteAdapter => ({
	id: spec.id,

	matches: (context) => {
		const host = hostOf(context.url);
		return Boolean(host && spec.hosts?.test(host));
	},

	matchesFingerprint: (context) => {
		// Fingerprints let one adapter serve every self-hosted instance of a platform.
		const signature = context.signature ?? EMPTY_SIGNATURE;
		return spec.fingerprint?.(signature) ?? false;
	},

	extract: (context) => {
		for (const selector of spec.content) {
			const content = tryContentSelector(selector, spec, context);
			if (content) {
				return content;
			}
		}

		// Nothing matched: decline rather than return an empty tree, so the generic extractor runs.
		return undefined;
	},
});

/**
 * Applies one content selector, returning the cleaned result if it holds enough text.
 *
 * Returns `undefined` so the caller can move on to the next candidate selector.
 */
const tryContentSelector = (selector: string, spec: SelectorAdapterSpec, context: AdapterContext): Hast | undefined => {
	const found = selectAll(selector, context.hast);
	if (found.length === 0) {
		return undefined;
	}

	for (const element of found) {
		removeAll(element, spec.remove);
	}

	const total = found.reduce((sum, element) => sum + new MetricsCollector().textLength(element), 0);
	if (total < (spec.minLength ?? DEFAULT_MIN_LENGTH)) {
		return undefined;
	}

	const decorated = spec.decorate?.(found, context);
	if (decorated) {
		return decorated;
	}

	return found.length === 1 ? found[0] : { type: "root", children: found };
};

/** Removes every node matching any of `selectors` from `root`, in place. */
export const removeAll = (root: Element | Hast, selectors: string[] | undefined): void => {
	if (!selectors || selectors.length === 0) {
		return;
	}

	const doomed = new Set<Element>();
	for (const selector of selectors) {
		for (const element of selectAll(selector, root)) {
			doomed.add(element);
		}
	}

	if (doomed.size > 0) {
		pruneInPlace(root, (node) => !(isElement(node) && doomed.has(node)));
	}
};

/** Convenience wrapper for adapters that need a single element. */
export const selectFirst = (root: Hast, selectors: string[]): Element | undefined => {
	for (const selector of selectors) {
		const found = select(selector, root);
		if (found) {
			return found;
		}
	}
	return undefined;
};

/**
 * Finds the first adapter that claims the page.
 *
 * Order matters: specific hosts are registered before the generic documentation-framework
 * fingerprints, so a Docusaurus-powered site with its own adapter still gets the specific one.
 */
export const resolveAdapterByHost = (context: AdapterContext, adapters: SiteAdapter[]): SiteAdapter | undefined => {
	for (const adapter of adapters) {
		try {
			if (adapter.matches(context)) {
				return adapter;
			}
		} catch {
			// A broken matcher must never take down a conversion.
		}
	}
	return undefined;
};

export const resolveAdapterByFingerprint = (
	context: AdapterContext,
	adapters: SiteAdapter[],
): SiteAdapter | undefined => {
	for (const adapter of adapters) {
		try {
			if (adapter.matchesFingerprint?.(context)) {
				return adapter;
			}
		} catch {
			// As above.
		}
	}
	return undefined;
};

/**
 * Finds the first adapter that claims the page.
 *
 * Hostname matching runs before platform fingerprints: it is a string test, and a known host is
 * always more reliable than a fingerprint that a host-specific site would also trigger.
 */
export const resolveAdapter = (context: AdapterContext, adapters: SiteAdapter[]): SiteAdapter | undefined =>
	resolveAdapterByHost(context, adapters) ?? resolveAdapterByFingerprint(context, adapters);
