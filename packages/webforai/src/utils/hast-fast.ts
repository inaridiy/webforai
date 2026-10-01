/**
 * Performance-critical HAST helpers.
 *
 * The v2 extractors leaned on `unist-util-filter` and `hast-util-to-string`, both of which
 * walk (and in the case of `filter`, deep-clone) the entire tree on every call. A single run
 * of `takumiExtractor` therefore cloned the document four times and re-walked it for every
 * length measurement. The helpers here replace both with a single mutation pass and a
 * memoised post-order metric walk.
 */

import type { Element, Nodes as Hast, Parent, RootContent } from "hast";

/** Text metrics for a subtree, gathered in one post-order pass. */
export interface TextMetrics {
	/** Length of the whitespace-normalised text content. */
	text: number;
	/** Length of text that sits inside an `<a>` descendant. */
	link: number;
	/** Number of sentence-separating commas (ASCII, CJK and Arabic). */
	commas: number;
	/** Number of `<p>`, `<pre>` and `<li>` descendants. */
	paragraphs: number;
	/** Number of element descendants (self excluded). */
	elements: number;
}

const EMPTY_METRICS: TextMetrics = { text: 0, link: 0, commas: 0, paragraphs: 0, elements: 0 };

/** Commas that separate clauses in prose. Boilerplate rarely contains them. */
const COMMA_REGEX = /[,、，،]/g;

const PARAGRAPH_LIKE = new Set(["p", "pre", "li", "blockquote", "figcaption", "dd", "dt"]);

/**
 * Elements whose text content must not be treated as prose. `<script>`/`<style>` bodies would
 * otherwise inflate the score of whatever container happens to hold them.
 */
const NON_PROSE_TAGS = new Set(["script", "style", "noscript", "template", "svg", "math", "iframe", "object"]);

export const isElement = (node: unknown): node is Element =>
	typeof node === "object" && node !== null && (node as Hast).type === "element";

export const isParent = (node: unknown): node is Parent =>
	typeof node === "object" && node !== null && Array.isArray((node as Parent).children);

/** Normalised class list, tolerating both the array and the raw-string shapes hast can produce. */
export const classList = (element: Element): string[] => {
	const className = element.properties?.className;
	if (Array.isArray(className)) {
		return className as string[];
	}
	if (typeof className === "string") {
		return className.split(/\s+/).filter(Boolean);
	}
	return [];
};

/** `"tagname#id .class1 .class2"` — the string the heuristic regexps are matched against. */
export const matchString = (element: Element): string => {
	const id = element.properties?.id;
	const classes = classList(element);
	if (!id && classes.length === 0) {
		return element.tagName;
	}
	return `${element.tagName} ${typeof id === "string" ? id : ""} ${classes.join(" ")}`;
};

/**
 * A memoised metric collector bound to one snapshot of a tree.
 *
 * The cache is only sound while the tree is unchanged, so callers create a fresh collector
 * after every mutation pass rather than invalidating entries individually.
 */
export class MetricsCollector {
	readonly #cache = new WeakMap<object, TextMetrics>();

	metrics(node: Hast): TextMetrics {
		if (node.type === "text") {
			const value = node.value;
			if (value.trim().length === 0) {
				return EMPTY_METRICS;
			}
			return {
				text: value.length,
				link: 0,
				commas: (value.match(COMMA_REGEX) ?? []).length,
				paragraphs: 0,
				elements: 0,
			};
		}

		if (!isParent(node)) {
			return EMPTY_METRICS;
		}

		const cached = this.#cache.get(node);
		if (cached) {
			return cached;
		}

		if (isElement(node) && NON_PROSE_TAGS.has(node.tagName)) {
			this.#cache.set(node, EMPTY_METRICS);
			return EMPTY_METRICS;
		}

		let text = 0;
		let link = 0;
		let commas = 0;
		let paragraphs = 0;
		let elements = 0;

		for (const child of node.children) {
			const childMetrics = this.metrics(child as Hast);
			text += childMetrics.text;
			link += childMetrics.link;
			commas += childMetrics.commas;
			paragraphs += childMetrics.paragraphs;
			elements += childMetrics.elements;
			if (isElement(child)) {
				elements += 1;
				if (PARAGRAPH_LIKE.has(child.tagName)) {
					paragraphs += 1;
				}
			}
		}

		// An `<a>` contributes all of its own text to the link budget of every ancestor.
		if (isElement(node) && node.tagName === "a") {
			link = text;
		}

		const metrics: TextMetrics = { text, link, commas, paragraphs, elements };
		this.#cache.set(node, metrics);
		return metrics;
	}

	textLength(node: Hast): number {
		return this.metrics(node).text;
	}

	/** Fraction of a subtree's text that is link anchor text. `0` for empty subtrees. */
	linkDensity(node: Hast): number {
		const { text, link } = this.metrics(node);
		if (text === 0) {
			return 0;
		}
		return Math.min(1, link / text);
	}
}

/**
 * Removes every node for which `keep` returns `false`, mutating `tree` in place.
 *
 * Unlike `unist-util-filter` this performs no cloning, so callers own the responsibility of
 * copying the tree beforehand when the input must stay untouched.
 *
 * `keep` is called top-down; returning `false` for a node skips its subtree entirely, which is
 * what makes a single pass sufficient.
 */
export const pruneInPlace = (tree: Hast, keep: (node: Hast, parent: Parent) => boolean): Hast => {
	if (!isParent(tree)) {
		return tree;
	}

	const stack: Parent[] = [tree];

	while (stack.length > 0) {
		// biome-ignore lint/style/noNonNullAssertion: guarded by the loop condition
		const parent = stack.pop()!;
		const children = parent.children;
		let write = 0;

		// Index-based on purpose: this compacts the array in place, so the read and write cursors
		// advance independently and a for-of loop cannot express it.
		// biome-ignore lint/style/useForOf: two independent cursors, see above
		for (let read = 0; read < children.length; read++) {
			const child = children[read] as Hast;
			if (!keep(child, parent)) {
				continue;
			}
			children[write++] = child as RootContent;
			if (isParent(child)) {
				stack.push(child);
			}
		}

		children.length = write;
	}

	return tree;
};

/**
 * Depth-first pre-order walk. Return `false` from `visit` to skip a subtree.
 *
 * `boolean | void` is deliberate: it is the standard visitor signature (unist-util-visit uses
 * the same shape) and lets callers that only observe nodes omit a return entirely.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: standard visitor signature, see above
export const walk = (tree: Hast, visit: (node: Hast, parent: Parent | undefined) => boolean | void): void => {
	const stack: Array<{ node: Hast; parent: Parent | undefined }> = [{ node: tree, parent: undefined }];

	while (stack.length > 0) {
		// biome-ignore lint/style/noNonNullAssertion: guarded by the loop condition
		const { node, parent } = stack.pop()!;
		if (visit(node, parent) === false) {
			continue;
		}
		if (isParent(node)) {
			// Pushed in reverse so that the walk observes children in document order.
			for (let i = node.children.length - 1; i >= 0; i--) {
				stack.push({ node: node.children[i] as Hast, parent: node });
			}
		}
	}
};

/**
 * Collects every element matching `predicate`.
 *
 * This exists to replace repeated `hast-util-select` calls: the CSS engine re-parses the
 * selector and re-walks the tree per call, while callers here usually only need a tag-name or
 * attribute test that a single traversal can answer.
 */
export const collectElements = (tree: Hast, predicate: (element: Element) => boolean): Element[] => {
	const found: Element[] = [];
	walk(tree, (node) => {
		if (isElement(node) && predicate(node)) {
			found.push(node);
		}
	});
	return found;
};

/** First element matching `predicate`, in document order. */
export const findElement = (tree: Hast, predicate: (element: Element) => boolean): Element | undefined => {
	let found: Element | undefined;
	walk(tree, (node) => {
		if (found) {
			return false;
		}
		if (isElement(node) && predicate(node)) {
			found = node;
			return false;
		}
	});
	return found;
};

/**
 * Structural clone of a HAST tree.
 *
 * `structuredClone` is available on every runtime the package targets (Node 18+, Deno, Bun,
 * Workers) and is markedly faster than a JSON round trip, but it rejects the `Object.create(null)`
 * prototypes that some HAST producers use for `properties`, so we fall back on a manual copy.
 */
export const cloneHast = <T extends Hast>(tree: T): T => {
	try {
		return structuredClone(tree);
	} catch {
		return manualClone(tree);
	}
};

const manualClone = <T>(node: T): T => {
	if (Array.isArray(node)) {
		return node.map(manualClone) as T;
	}
	if (typeof node !== "object" || node === null) {
		return node;
	}
	const copy: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node)) {
		copy[key] = manualClone(value);
	}
	return copy as T;
};

/** Wraps loose nodes into a root so downstream utilities always receive a single tree. */
export const asRoot = (nodes: Hast | RootContent[]): Hast => {
	if (Array.isArray(nodes)) {
		return { type: "root", children: nodes };
	}
	return nodes;
};

/**
 * Reads a raw property, accepting the attribute spelling as written in HTML.
 *
 * `hast-util-from-html` stores attributes under their DOM property names, so `aria-hidden`
 * becomes `ariaHidden` and `data-rwidth` becomes `dataRwidth`. Looking up the hyphenated form
 * directly always misses — a mistake that silently disabled several v2 filters — so this
 * helper checks the verbatim key first and then the camel-cased spelling.
 */
export const property = (element: Element, key: string): unknown => {
	const properties = element.properties;
	if (!properties) {
		return undefined;
	}
	const direct = properties[key];
	if (direct !== undefined) {
		return direct;
	}
	if (!(key.includes("-") || key.includes(":"))) {
		return undefined;
	}
	return properties[camelCaseAttribute(key)];
};

/** `aria-hidden` -> `ariaHidden`, `data-r-width` -> `dataRWidth`, `xml:lang` -> `xmlLang`. */
const camelCaseAttribute = (key: string): string =>
	key.replace(/[-:]([a-z])/g, (_, character: string) => character.toUpperCase());

/** Reads a property as a finite number, tolerating the string form attributes arrive in. */
export const numericProperty = (element: Element, key: string): number | undefined => {
	const raw = property(element, key);
	if (typeof raw === "number") {
		return Number.isFinite(raw) ? raw : undefined;
	}
	if (typeof raw === "string" && raw.length > 0) {
		const parsed = Number.parseFloat(raw);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
};

/** Reads a property as a string, joining the array form hast uses for token lists. */
export const stringProperty = (element: Element, key: string): string | undefined => {
	const raw = property(element, key);
	if (typeof raw === "string") {
		return raw;
	}
	if (Array.isArray(raw)) {
		return raw.join(" ");
	}
	if (raw === true) {
		return "";
	}
	return undefined;
};

/** True when the attribute is present at all, regardless of its value. */
export const hasProperty = (element: Element, key: string): boolean => property(element, key) !== undefined;

/**
 * True for attributes that follow the ARIA/HTML "true unless explicitly false" convention.
 *
 * Boolean HTML attributes (`hidden`) arrive as `true`, while ARIA states arrive as the strings
 * `"true"`/`"false"`, and an empty string means present-and-true.
 */
export const isTruthyAttribute = (element: Element, key: string): boolean => {
	const raw = property(element, key);
	if (raw === undefined || raw === null || raw === false) {
		return false;
	}
	if (raw === true) {
		return true;
	}
	if (typeof raw === "string") {
		return raw.toLowerCase() !== "false";
	}
	return true;
};
