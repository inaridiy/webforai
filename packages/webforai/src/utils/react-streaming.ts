import type { Element, ElementContent, Nodes as Hast, Parent } from "hast";

import { isElement, stringProperty, walk } from "./hast-fast";

/** React's inline instructions: `$RC("B:0","S:0")` completes a boundary, `$RS("S:1","P:1")` fills a placeholder. */
const INSTRUCTION = /\$R([CS])\("([^"]+)","([^"]+)"/g;

/** True for the scripts {@link resolveStreamedContent} reads, so that script stripping keeps them. */
export const isStreamingInstruction = (script: string): boolean => /\$R[CS]\("/.test(script);

/** Segments put back per page; the rest stay hidden, as all of them were before. */
const MAX_STREAMED_SEGMENTS = 1000;

/** Comments that open a Suspense boundary; `/$` closes one. */
const BOUNDARY_OPEN = new Set(["$", "$?", "$!", "$~"]);

/** The index of the `/$` comment that closes the boundary whose content starts at `from`. */
const boundaryEnd = (children: Parent["children"], from: number): number => {
	let depth = 0;
	let index = from;
	for (; index < children.length; index++) {
		const child = children[index];
		if (child.type !== "comment") {
			continue;
		}
		if (child.value === "/$") {
			if (depth === 0) {
				break;
			}
			depth -= 1;
		} else if (BOUNDARY_OPEN.has(child.value)) {
			depth += 1;
		}
	}
	return index;
};

/** A pairing of a boundary (`B:`) or placeholder (`P:`) template with the segment (`S:`) that fills it. */
type Pair = [target: string, segment: string];

interface Streamed {
	templates: Map<string, Element>;
	segments: Map<string, Element>;
	parents: Map<Hast, Parent>;
	pairs: Pair[];
}

const instructionPairs = (script: Element): Pair[] => {
	const first = script.children[0];
	if (first?.type !== "text") {
		return [];
	}
	return [...first.value.matchAll(INSTRUCTION)].map((match) =>
		match[1] === "C" ? [match[2], match[3]] : [match[3], match[2]],
	);
};

/** Finds the placeholders, the streamed segments and the instructions that pair them. */
const collect = (tree: Hast): Streamed => {
	const found: Streamed = { templates: new Map(), segments: new Map(), parents: new Map(), pairs: [] };
	walk(tree, (node, parent) => {
		if (!(isElement(node) && parent)) {
			return;
		}
		if (node.tagName === "script") {
			found.pairs.push(...instructionPairs(node));
			return false;
		}
		const id = stringProperty(node, "id") ?? "";
		if (node.tagName === "template" && /^[BP]:/.test(id)) {
			found.templates.set(id, node);
			found.parents.set(node, parent);
			return false;
		}
		if (node.tagName === "div" && id.startsWith("S:") && node.properties.hidden) {
			found.segments.set(id, node);
			found.parents.set(node, parent);
		}
	});
	return found;
};

/** Segments no instruction names go to the boundary or placeholder with their own number. */
const pairByNumber = ({ templates, segments, pairs }: Streamed): void => {
	const paired = new Set(pairs.map(([, segment]) => segment));
	for (const id of segments.keys()) {
		const number = id.slice(2);
		const target = [`B:${number}`, `P:${number}`].find((candidate) => templates.has(candidate));
		if (target && !paired.has(id)) {
			pairs.push([target, id]);
		}
	}
};

/** Moves one segment's children to its template's place. A boundary's fallback and comments go. */
const fill = ({ templates, segments, parents }: Streamed, [targetId, segmentId]: Pair): boolean => {
	const template = templates.get(targetId);
	const segment = segments.get(segmentId);
	const parent = template && parents.get(template);
	const segmentParent = segment && parents.get(segment);
	if (!(template && segment && parent && segmentParent)) {
		return false;
	}
	const at = parent.children.indexOf(template);
	const segmentAt = segmentParent.children.indexOf(segment);
	if (at < 0 || segmentAt < 0) {
		return false;
	}
	segmentParent.children.splice(segmentAt, 1);
	// Removing the segment shifts the template when both sit in the same parent.
	let start = parent === segmentParent && segmentAt < at ? at - 1 : at;
	let end = start + 1;
	if (targetId.startsWith("B:")) {
		end = Math.min(boundaryEnd(parent.children, start + 1) + 1, parent.children.length);
		const before = parent.children[start - 1];
		if (before?.type === "comment" && BOUNDARY_OPEN.has(before.value)) {
			start -= 1;
		}
	}
	const content = segment.children as ElementContent[];
	// Not `splice(start, n, ...content)`: a segment can hold more children than a call has arguments.
	const siblings = parent.children as ElementContent[];
	parent.children = siblings.slice(0, start).concat(content, siblings.slice(end)) as typeof parent.children;
	for (const child of content) {
		if (parents.has(child)) {
			parents.set(child, parent);
		}
	}
	templates.delete(targetId);
	segments.delete(segmentId);
	return true;
};

/**
 * Puts content that React streamed after the page's shell where the browser would put it.
 *
 * A server-rendered React page (Next.js' App Router, GitBook) sends the parts that were not
 * ready as placeholders — `<!--$?--><template id="B:3"></template>…skeleton…<!--/$-->` — and
 * appends each finished part to the end of the document as `<div hidden id="S:3">…</div>` with a
 * script that moves it: `$RC("B:3","S:3")`. Without that script running, the content is a hidden
 * element far from its place: every code block of a GitBook page, the article body of a blog.
 * Extraction drops hidden elements, so it was lost.
 *
 * Each segment replaces its boundary's fallback (or its `P:` placeholder, for `$RS`). The pairing
 * is read from the instruction scripts; where they were stripped, a segment goes to the boundary
 * or placeholder with its own number, which is what React emits when no placeholder segments
 * shift the count.
 *
 * @returns Whether anything was moved. The tree is changed in place.
 */
export const resolveStreamedContent = (tree: Hast): boolean => {
	const found = collect(tree);
	if (found.templates.size === 0 || found.segments.size === 0) {
		return false;
	}
	pairByNumber(found);
	let moved = false;
	// Each fill rebuilds one parent's child list, so a page made of placeholders would cost the
	// square of their number; a real page streams a handful of boundaries, at most a few hundred.
	for (const pair of found.pairs.slice(0, MAX_STREAMED_SEGMENTS)) {
		moved = fill(found, pair) || moved;
	}
	return moved;
};
