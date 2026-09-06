/**
 * HAST normalisation, applied after extraction and before the Markdown conversion.
 *
 * These passes repair markup patterns that `hast-util-to-mdast` cannot interpret on its own:
 * lazily-loaded images whose real URL lives in a data attribute, maths rendered twice for
 * accessibility, headings expressed only through ARIA, and inline semantics that Markdown has no
 * syntax for. Each one fixes an output defect observable on real pages.
 */

import type { Element, Nodes as Hast } from "hast";

import {
	classList,
	findElement,
	isElement,
	numericProperty,
	property,
	pruneInPlace,
	stringProperty,
	walk,
} from "../utils/hast-fast";

/** Attributes that hold the real image URL while `src` holds a placeholder. */
const LAZY_SRC_ATTRIBUTES = [
	"data-src",
	"data-original",
	"data-lazy-src",
	"data-original-src",
	"data-actualsrc",
	"data-hi-res-src",
	"data-echo",
];

/**
 * `src` values that are placeholders rather than real images.
 *
 * Every `data:` image qualifies, whatever its size. A large inline blob sitting beside a
 * `data-src` is still a placeholder — usually a blurred preview — and declining to replace it
 * loses the real image entirely, because a sourceless image is dropped further down the pipeline.
 */
const PLACEHOLDER_SRC = /^$|^data:image\/|^about:blank$|spacer\.gif$|blank\.(gif|png)$/i;

/**
 * Reads a `srcset`-shaped attribute.
 *
 * Two details make the plain property lookup fail: HAST stores the attribute under its DOM name
 * `srcSet`, and because it is a comma-separated list property the value arrives as an array.
 * Joining that array with spaces (the generic behaviour) destroys the entry boundaries, so the
 * commas have to be put back.
 */
const readSrcset = (element: Element, attribute: string): string | undefined => {
	// Goes through `property` rather than indexing directly: `data-srcset` is stored as
	// `dataSrcset`, so a raw lookup silently never matched.
	const raw = property(element, attribute);
	if (typeof raw === "string") {
		return raw;
	}
	if (Array.isArray(raw)) {
		return raw.join(", ");
	}
	return undefined;
};

/**
 * Picks the largest candidate from a `srcset`.
 *
 * Descriptors come in `w` (width) and `x` (density) forms; both are ordered, so the last entry
 * with the highest descriptor is the highest-resolution image.
 */
export const bestFromSrcset = (srcset: string): string | undefined => {
	let best: { url: string; weight: number } | undefined;

	for (const entry of srcset.split(",")) {
		const parts = entry.trim().split(/\s+/);
		const url = parts[0];
		if (!url) {
			continue;
		}

		const descriptor = parts[1];
		let weight = 1;
		if (descriptor?.endsWith("w")) {
			weight = Number.parseFloat(descriptor) || 1;
		} else if (descriptor?.endsWith("x")) {
			// Density descriptors are small numbers; scale them so they compare sensibly against
			// width descriptors when a srcset mixes the two.
			weight = (Number.parseFloat(descriptor) || 1) * 1000;
		}

		if (!best || weight > best.weight) {
			best = { url, weight };
		}
	}

	return best?.url;
};

/**
 * Gives every image a usable `src`.
 *
 * Lazy-loading is near-universal, and without this pass those images convert to `![alt]()` —
 * an empty link that is worse than no image at all.
 */
export const resolveImageSources = (tree: Hast): void => {
	walk(tree, (node) => {
		if (!isElement(node) || node.tagName !== "img") {
			return;
		}

		const current = stringProperty(node, "src");
		if (current && !PLACEHOLDER_SRC.test(current)) {
			return;
		}

		for (const attribute of LAZY_SRC_ATTRIBUTES) {
			const candidate = stringProperty(node, attribute);
			if (candidate && !PLACEHOLDER_SRC.test(candidate)) {
				node.properties.src = candidate;
				return;
			}
		}

		for (const attribute of ["srcSet", "srcset", "data-srcset"]) {
			const srcset = readSrcset(node, attribute);
			const best = srcset ? bestFromSrcset(srcset) : undefined;
			if (best) {
				node.properties.src = best;
				return;
			}
		}
	});
};

/** KaTeX renders the formula twice; the styled HTML copy is the redundant one. */
const katexDuplicates = (node: Element): Element[] => {
	const classes = classList(node);
	if (!(classes.includes("katex") || classes.includes("katex-display"))) {
		return [];
	}

	const hasMathml = node.children.some(
		(child) => isElement(child) && classList(child).includes("katex-mathml") && hasMathSource(child),
	);
	if (!hasMathml) {
		return [];
	}

	return node.children.filter((child): child is Element => isElement(child) && classList(child).includes("katex-html"));
};

/**
 * MediaWiki renders each formula as MathML plus a fallback PNG whose `alt` holds the LaTeX.
 *
 * Converting both yields the expression twice — once as `$...$` and once as an image whose alt
 * text is the same formula. The MathML is kept because it becomes real LaTeX.
 */
const mediawikiDuplicates = (node: Element): Element[] => {
	if (!classList(node).includes("mwe-math-element") || !hasMathSource(node)) {
		return [];
	}
	return node.children.filter(
		(child): child is Element =>
			isElement(child) && classList(child).some((name) => name.startsWith("mwe-math-fallback-image")),
	);
};

/** MathJax v3 keeps the source MathML in an assistive node beside the rendered glyphs. */
const mathjaxDuplicates = (node: Element): Element[] => {
	if (node.tagName !== "mjx-container") {
		return [];
	}
	const hasMathml = node.children.some(
		(child) => isElement(child) && child.tagName === "mjx-assistive-mml" && hasMathSource(child),
	);
	if (!hasMathml) {
		return [];
	}
	return node.children.filter((child): child is Element => isElement(child) && child.tagName !== "mjx-assistive-mml");
};

/** A wrapper alone is not an alternative formula; some renderers omit assistive MathML. */
const hasMathSource = (node: Element): boolean =>
	Boolean(findElement(node, (element) => element.tagName === "math" && element.children.length > 0));

/**
 * Removes the duplicated half of a rendered maths expression.
 *
 * KaTeX and MathJax emit the formula twice — once as MathML for screen readers and once as
 * styled HTML for sighted users — so converting both yields the expression twice in a row
 * (`$E$E`). The MathML copy is kept because it converts losslessly to LaTeX.
 */
export const dedupeRenderedMath = (tree: Hast): void => {
	const doomed = new Set<Element>();

	walk(tree, (node) => {
		if (!isElement(node)) {
			return;
		}
		for (const duplicate of [...katexDuplicates(node), ...mathjaxDuplicates(node), ...mediawikiDuplicates(node)]) {
			doomed.add(duplicate);
		}
	});

	if (doomed.size > 0) {
		pruneInPlace(tree, (node) => !(isElement(node) && doomed.has(node)));
	}
};

/**
 * Turns ARIA headings into real heading elements.
 *
 * Component libraries frequently render headings as `<div role="heading" aria-level="2">`, which
 * carries the same meaning as `<h2>` but converts to an anonymous paragraph.
 */
export const promoteAriaHeadings = (tree: Hast): void => {
	walk(tree, (node) => {
		if (!isElement(node) || stringProperty(node, "role") !== "heading") {
			return;
		}
		if (/^h[1-6]$/.test(node.tagName)) {
			return;
		}

		const level = numericProperty(node, "aria-level") ?? 2;
		const clamped = Math.min(6, Math.max(1, Math.round(level)));
		node.tagName = `h${clamped}`;
	});
};

export interface NormalizeOptions {
	/** Resolve lazily-loaded image URLs. Default `true`. */
	images?: boolean;
	/** Drop the duplicated half of KaTeX/MathJax output. Default `true`. */
	math?: boolean;
	/** Promote `role="heading"` elements to real headings. Default `true`. */
	ariaHeadings?: boolean;
}

/**
 * Applies every normalisation pass, in place.
 *
 * @param tree - The HAST tree to normalise. Mutated directly.
 * @param options - {@link NormalizeOptions}
 */
export const normalizeHast = (tree: Hast, options: NormalizeOptions = {}): Hast => {
	const { images = true, math = true, ariaHeadings = true } = options;

	if (images) {
		resolveImageSources(tree);
	}
	if (math) {
		dedupeRenderedMath(tree);
	}
	if (ariaHeadings) {
		promoteAriaHeadings(tree);
	}

	return tree;
};
