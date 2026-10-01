/**
 * Converter-agnostic quality signals for `bench:compare`.
 *
 * Everything here is frozen before measuring and documented in the generated report. The
 * definitions deliberately reuse the existing harness regexes (`convert.ts`) so that numbers are
 * comparable with `report` and the corpus test.
 */

import { fromHtml } from "hast-util-from-html";

import { EXPECTATIONS, type SiteExpectation } from "./assertions.js";
import type { CorpusSite } from "./corpus.js";
import type { RenderMode } from "./fetch.js";

// ------------------------------------------------------------------------ assertion checks

export interface Check {
	name: string;
	pass: boolean;
	/** Set when the check is excluded from the cross-tool comparison; the value is the reason. */
	excluded?: string;
}

/**
 * Anchors whose wording is webforai's own output format rather than a property of the page.
 *
 * - The YouTube adapter renders the embedded player JSON as `- Channel:` / `- Duration:` lines;
 *   another tool could carry the same facts in any other shape.
 * - The Hacker News adapter titles the thread `## Comments` and encodes reply depth as nested
 *   blockquotes — a formatting convention, not something present in the source page.
 *
 * The `^# .+` title anchors on the same pages stay in: a title heading is converter-agnostic.
 */
const FORMAT_SPECIFIC_ANCHORS: Record<string, string[]> = {
	"youtube-video": [String(/^- Channel: .+/m), String(/^- Duration: \d+:\d{2}/m)],
	"hackernews-item": ["## Comments", String(/^> /m)],
};

const ADAPTER_EXCLUSION = "webforai-internal: checks which webforai site adapter claims the page";
const FORMAT_EXCLUSION = "webforai output format: the anchor matches the adapter's own Markdown convention";

const expectationsForCapture = (site: CorpusSite, mode: RenderMode): SiteExpectation[] =>
	EXPECTATIONS.filter(
		(entry) => entry.id === site.id && (entry.mode ?? (site.render === "rendered" ? "rendered" : "static")) === mode,
	);

export const hasExpectations = (site: CorpusSite, mode: RenderMode): boolean =>
	expectationsForCapture(site, mode).length > 0;

const STRUCTURE_METRIC = {
	minHeadings: "headings",
	minCodeBlocks: "codeBlocks",
	minTables: "tables",
	minLength: "characters",
	maxLength: "characters",
	maxNavLinkRatio: "navLinkRatio",
} as const;

/**
 * Applies the existing `assertions.ts` expectations to any converter's output.
 *
 * Mirrors `corpus.test.ts`. Adapter-claim checks cannot be evaluated for other tools and are
 * listed as excluded, so the webforai-only total stays visible.
 */
export const runChecks = (site: CorpusSite, mode: RenderMode, markdown: string, metrics: OutputMetrics): Check[] => {
	const checks: Check[] = [];
	const formatSpecific = FORMAT_SPECIFIC_ANCHORS[site.id] ?? [];

	for (const expectation of expectationsForCapture(site, mode)) {
		for (const [key, expected] of Object.entries(expectation.structure ?? {})) {
			const metric = STRUCTURE_METRIC[key as keyof typeof STRUCTURE_METRIC];
			const actual = metrics[metric];
			checks.push({
				name: `${key}: ${expected}`,
				pass: key.startsWith("max") ? actual <= expected : actual >= expected,
			});
		}
		for (const anchor of expectation.mustContain ?? []) {
			const pass = typeof anchor === "string" ? markdown.includes(anchor) : anchor.test(markdown);
			const excluded = formatSpecific.includes(String(anchor)) ? FORMAT_EXCLUSION : undefined;
			checks.push({ name: `contains ${String(anchor)}`, pass, excluded });
		}
		for (const anchor of expectation.mustNotContain ?? []) {
			const pass = typeof anchor === "string" ? !markdown.includes(anchor) : !anchor.test(markdown);
			checks.push({ name: `excludes ${String(anchor)}`, pass });
		}
		if (expectation.adapter) {
			// Evaluated separately (webforai only) by the runner; never part of the cross-tool score.
			checks.push({ name: `adapter ${expectation.adapter}`, pass: false, excluded: ADAPTER_EXCLUSION });
		}
	}

	return checks;
};

// ------------------------------------------------------------------------ output metrics

export interface OutputMetrics {
	characters: number;
	headings: number;
	codeBlocks: number;
	tables: number;
	navLinkRatio: number;
	/** Raw `<table` markup left in the Markdown (e.g. a header-less table the converter skipped). */
	rawHtmlTables: number;
	/** Generic boilerplate phrases found, see {@link BOILERPLATE_MARKERS}. */
	boilerplateMarkers: string[];
}

const countMatches = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

/**
 * Generic page-chrome phrases, matched case-insensitively anywhere in the output.
 *
 * Frozen before measuring. They are typical of headers, footers and consent banners and rare in
 * article prose, but not impossible there — treat counts as a leak *signal*, not proof.
 */
export const BOILERPLATE_MARKERS = [
	"skip to content",
	"skip to main content",
	"jump to content",
	"accept all cookies",
	"cookie settings",
	"cookie preferences",
	"manage cookies",
	"privacy policy",
	"terms of service",
	"terms of use",
	"all rights reserved",
	"subscribe to our newsletter",
	"sign up for free",
	"footer navigation",
] as const;

// `hast` types are not a direct dependency of this package; derive them from the parser instead.
type HastRoot = ReturnType<typeof fromHtml>;
type HastContent = HastRoot["children"][number];
type Hast = HastRoot | HastContent;
type Element = Extract<HastContent, { type: "element" }>;

export const measureOutput = (markdown: string): OutputMetrics => {
	const lines = markdown.split("\n").filter((line) => line.trim().length > 0);
	const linkOnly = lines.filter((line) => /^\s*[-*]?\s*!?\[[^\]]*\]\([^)]*\)\s*$/.test(line)).length;
	const lower = markdown.toLowerCase();

	return {
		characters: markdown.length,
		headings: countMatches(markdown, /^#{1,6} /gm),
		codeBlocks: countMatches(markdown, /^```/gm) / 2,
		tables: countMatches(markdown, /^\|[-: |]+\|$/gm),
		navLinkRatio: lines.length === 0 ? 0 : linkOnly / lines.length,
		rawHtmlTables: countMatches(markdown, /<table[\s>]/gi),
		boilerplateMarkers: BOILERPLATE_MARKERS.filter((marker) => lower.includes(marker)),
	};
};

// ------------------------------------------------------------------------ source analysis

export interface SourceFacts {
	/** One probe line per `<pre>` block in the source that has a usable line. */
	codeProbes: string[];
	/** `<table>` elements with at least one `<th>` and no nested table. */
	dataTables: number;
}

const normalizeLine = (line: string): string => line.replace(/\s+/g, " ").trim();

const LINE_BLOCK_TAGS = new Set(["div", "p", "li", "tr", "table"]);

const collectText = (node: Hast, out: string[]): void => {
	if (node.type === "text") {
		out.push(node.value);
		return;
	}
	if (node.type === "element" && node.tagName === "br") {
		out.push("\n");
		return;
	}
	// Highlighters often render each code line as a block element with no newline text between
	// them (e.g. `<div class="line">`); a block boundary is a line boundary.
	const isBlock = node.type === "element" && LINE_BLOCK_TAGS.has(node.tagName);
	if (isBlock) {
		out.push("\n");
	}
	if ("children" in node) {
		for (const child of node.children) {
			collectText(child as Hast, out);
		}
	}
	if (isBlock) {
		out.push("\n");
	}
};

const hasDescendant = (node: Element, tagName: string): boolean =>
	node.children.some(
		(child) => child.type === "element" && (child.tagName === tagName || hasDescendant(child, tagName)),
	);

/**
 * Probe line for a code block: its longest line of at least 12 characters (after whitespace
 * normalization), capped at 200 so a minified blob cannot dominate.
 */
const probeFor = (pre: Element): string | undefined => {
	const parts: string[] = [];
	collectText(pre, parts);
	const candidates = parts
		.join("")
		.split("\n")
		.map(normalizeLine)
		.filter((line) => line.length >= 12 && line.length <= 200);
	return candidates.sort((a, b) => b.length - a.length)[0];
};

export const analyzeSource = (html: string): SourceFacts => {
	const tree = fromHtml(html, { fragment: true });
	const codeProbes: string[] = [];
	let dataTables = 0;

	const walk = (node: Hast): void => {
		if (node.type === "element") {
			if (node.tagName === "pre") {
				const probe = probeFor(node);
				if (probe) {
					codeProbes.push(probe);
				}
				// Nested <pre> is not a separate block.
				return;
			}
			if (node.tagName === "table" && hasDescendant(node, "th") && !hasDescendant(node, "table")) {
				dataTables++;
			}
		}
		if ("children" in node) {
			for (const child of node.children) {
				walk(child as Hast);
			}
		}
	};
	walk(tree);

	return { codeProbes, dataTables };
};

/** Normalized lines that sit inside fenced code blocks (``` or ~~~) of the output. */
const fencedLines = (markdown: string): Set<string> => {
	const result = new Set<string>();
	let fence: string | undefined;
	for (const line of markdown.split("\n")) {
		const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
		if (fence === undefined) {
			if (marker) {
				fence = marker;
			}
			continue;
		}
		if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) {
			fence = undefined;
			continue;
		}
		result.add(normalizeLine(line));
	}
	return result;
};

export interface FidelityCounts {
	codeProbes: number;
	/** Probes found verbatim on a line inside a fenced block. */
	codeProbesFenced: number;
	dataTables: number;
	/** min(GFM tables in output, data tables in source). */
	tablesPreserved: number;
}

export const measureFidelity = (source: SourceFacts, markdown: string, metrics: OutputMetrics): FidelityCounts => {
	const fenced = fencedLines(markdown);
	return {
		codeProbes: source.codeProbes.length,
		codeProbesFenced: source.codeProbes.filter((probe) => fenced.has(probe)).length,
		dataTables: source.dataTables,
		tablesPreserved: Math.min(metrics.tables, source.dataTables),
	};
};
