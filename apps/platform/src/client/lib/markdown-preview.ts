/**
 * A deliberately small Markdown-subset parser for the landing-page demo preview.
 *
 * It exists so the demo can show "what the Markdown looks like rendered" next to the raw
 * text. It is not a Markdown implementation: it covers what `htmlToMarkdown` emits for
 * ordinary article pages (frontmatter, headings, paragraphs, fenced code, lists, quotes,
 * emphasis, inline code, links, images) and renders everything else as plain text. The
 * output is a plain AST rendered with React elements — never injected HTML — so untrusted
 * page content cannot script the preview.
 */

export type InlineNode =
	| { kind: "text"; text: string }
	| { kind: "strong"; children: InlineNode[] }
	| { kind: "em"; children: InlineNode[] }
	| { kind: "code"; text: string }
	| { kind: "link"; href: string | undefined; children: InlineNode[] };

export type Block =
	| { kind: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
	| { kind: "paragraph"; children: InlineNode[] }
	| { kind: "code"; lang: string | undefined; text: string }
	| { kind: "list"; ordered: boolean; items: InlineNode[][] }
	| { kind: "quote"; children: InlineNode[] }
	| { kind: "hr" };

export type FrontmatterEntry = { key: string; value: string };

export type MarkdownPreviewDoc = {
	frontmatter: FrontmatterEntry[];
	blocks: Block[];
};

/** Links in scraped Markdown are untrusted; anything but plain web schemes renders as text. */
export const safeHref = (href: string): string | undefined => {
	const trimmed = href.trim();
	if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
		return trimmed;
	}
	return undefined;
};

const text = (value: string): InlineNode => ({ kind: "text", text: value });

type InlinePattern = {
	regex: RegExp;
	build: (match: RegExpExecArray) => InlineNode;
};

/** A capture group the pattern guarantees; `??` only satisfies `noUncheckedIndexedAccess`. */
const group = (match: RegExpExecArray, index: number): string => match[index] ?? "";

/** Order is the tie-break when two patterns match at the same index. */
const INLINE_PATTERNS: InlinePattern[] = [
	{ regex: /`([^`\n]+)`/, build: (m) => ({ kind: "code", text: group(m, 1) }) },
	{
		// An image renders as a link labelled with its alt text: the preview must not load
		// third-party resources, but the reference should stay visible and followable.
		regex: /!\[([^\]]*)\]\(([^()\s]+)\)/,
		build: (m) => ({ kind: "link", href: safeHref(group(m, 2)), children: [text(group(m, 1) || "image")] }),
	},
	{
		regex: /\[([^\]]+)\]\(([^()\s]+)\)/,
		build: (m) => ({ kind: "link", href: safeHref(group(m, 2)), children: parseInline(group(m, 1)) }),
	},
	{ regex: /\*\*([^*\n]+)\*\*/, build: (m) => ({ kind: "strong", children: parseInline(group(m, 1)) }) },
	{ regex: /\*([^*\n]+)\*/, build: (m) => ({ kind: "em", children: parseInline(group(m, 1)) }) },
	{ regex: /_([^_\n]+)_/, build: (m) => ({ kind: "em", children: parseInline(group(m, 1)) }) },
];

export const parseInline = (source: string): InlineNode[] => {
	const nodes: InlineNode[] = [];
	let rest = source;
	while (rest.length > 0) {
		let earliest: { index: number; match: RegExpExecArray; pattern: InlinePattern } | undefined;
		for (const pattern of INLINE_PATTERNS) {
			const match = pattern.regex.exec(rest);
			if (match !== null && (earliest === undefined || match.index < earliest.index)) {
				earliest = { index: match.index, match, pattern };
			}
		}
		if (earliest === undefined) {
			nodes.push(text(rest));
			break;
		}
		if (earliest.index > 0) {
			nodes.push(text(rest.slice(0, earliest.index)));
		}
		nodes.push(earliest.pattern.build(earliest.match));
		rest = rest.slice(earliest.index + earliest.match[0].length);
	}
	return nodes;
};

const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED_ITEM = /^\s*[-*+]\s+(.*)$/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^```(.*)$/;
const HR = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;

const parseFrontmatter = (lines: string[]): { entries: FrontmatterEntry[]; consumed: number } | undefined => {
	if (lines[0]?.trim() !== "---") {
		return undefined;
	}
	const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (closing === -1) {
		return undefined;
	}
	const entries: FrontmatterEntry[] = [];
	for (const line of lines.slice(1, closing)) {
		const colon = line.indexOf(":");
		if (colon > 0) {
			entries.push({ key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
		}
	}
	return { entries, consumed: closing + 1 };
};

/** One recognized non-paragraph block starting at `index`, or undefined to fall through. */
type Consumed = { block: Block; next: number };

/** In-bounds by construction everywhere it is used; `??` only satisfies `noUncheckedIndexedAccess`. */
const lineAt = (lines: string[], index: number): string => lines[index] ?? "";

const consumeFence = (lines: string[], index: number): Consumed | undefined => {
	const fence = FENCE.exec(lineAt(lines, index).trim());
	if (fence === null) {
		return undefined;
	}
	const body: string[] = [];
	let cursor = index + 1;
	while (cursor < lines.length && !FENCE.test(lineAt(lines, cursor).trim())) {
		body.push(lineAt(lines, cursor));
		cursor += 1;
	}
	const lang = group(fence, 1).trim();
	return {
		block: { kind: "code", lang: lang.length > 0 ? lang : undefined, text: body.join("\n") },
		// Skip the closing fence (or run past EOF on an unclosed one).
		next: cursor + 1,
	};
};

const consumeHeading = (lines: string[], index: number): Consumed | undefined => {
	const heading = HEADING.exec(lineAt(lines, index).trim());
	if (heading === null) {
		return undefined;
	}
	return {
		block: {
			kind: "heading",
			depth: group(heading, 1).length as 1 | 2 | 3 | 4 | 5 | 6,
			children: parseInline(group(heading, 2)),
		},
		next: index + 1,
	};
};

const consumeHr = (lines: string[], index: number): Consumed | undefined =>
	HR.test(lineAt(lines, index).trim()) ? { block: { kind: "hr" }, next: index + 1 } : undefined;

const consumeList = (lines: string[], index: number): Consumed | undefined => {
	const line = lineAt(lines, index);
	if (!(UNORDERED_ITEM.test(line) || ORDERED_ITEM.test(line))) {
		return undefined;
	}
	const ordered = ORDERED_ITEM.test(line) && !UNORDERED_ITEM.test(line);
	const pattern = ordered ? ORDERED_ITEM : UNORDERED_ITEM;
	const items: InlineNode[][] = [];
	let cursor = index;
	while (cursor < lines.length) {
		const item = pattern.exec(lineAt(lines, cursor));
		if (item === null) {
			break;
		}
		items.push(parseInline(group(item, 1)));
		cursor += 1;
	}
	return { block: { kind: "list", ordered, items }, next: cursor };
};

const consumeQuote = (lines: string[], index: number): Consumed | undefined => {
	if (!lineAt(lines, index).trim().startsWith(">")) {
		return undefined;
	}
	const quoted: string[] = [];
	let cursor = index;
	while (cursor < lines.length && lineAt(lines, cursor).trim().startsWith(">")) {
		quoted.push(lineAt(lines, cursor).trim().replace(/^>\s?/, ""));
		cursor += 1;
	}
	return { block: { kind: "quote", children: parseInline(quoted.join(" ")) }, next: cursor };
};

const BLOCK_CONSUMERS = [consumeFence, consumeHeading, consumeHr, consumeList, consumeQuote];

const consumeBlock = (lines: string[], index: number): Consumed | undefined => {
	for (const consumer of BLOCK_CONSUMERS) {
		const consumed = consumer(lines, index);
		if (consumed !== undefined) {
			return consumed;
		}
	}
	return undefined;
};

export const parseMarkdownPreview = (markdown: string): MarkdownPreviewDoc => {
	const lines = markdown.replaceAll("\r\n", "\n").split("\n");
	const front = parseFrontmatter(lines);
	const blocks: Block[] = [];
	let index = front?.consumed ?? 0;
	let paragraph: string[] = [];

	const flushParagraph = (): void => {
		if (paragraph.length > 0) {
			blocks.push({ kind: "paragraph", children: parseInline(paragraph.join(" ")) });
			paragraph = [];
		}
	};

	while (index < lines.length) {
		const trimmed = lineAt(lines, index).trim();
		if (trimmed.length === 0) {
			flushParagraph();
			index += 1;
			continue;
		}
		const consumed = consumeBlock(lines, index);
		if (consumed !== undefined) {
			flushParagraph();
			blocks.push(consumed.block);
			index = consumed.next;
			continue;
		}
		paragraph.push(trimmed);
		index += 1;
	}
	flushParagraph();

	return { frontmatter: front?.entries ?? [], blocks };
};
