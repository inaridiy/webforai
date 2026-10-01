import type { Html, InlineCode, Nodes as Mdast, PhrasingContent, RootContent, Table } from "mdast";

/**
 * GFM table cells hold one line of phrasing content.
 *
 * HTML cells routinely hold paragraphs, lists and whole code samples — comparison tables in
 * documentation put a code block in every cell, infoboxes put lists in them. Serialised as-is,
 * the block content either breaks the row across lines (corrupting the whole table) or is escaped
 * into `&#xA;` noise. Flattening each such cell to phrasing joined by `<br>`, the line break GFM
 * renderers accept inside a cell, keeps the table a table and the content readable.
 */

const PHRASING_TYPES = new Set([
	"text",
	"emphasis",
	"strong",
	"delete",
	"inlineCode",
	"link",
	"linkReference",
	"image",
	"imageReference",
	"html",
	"footnoteReference",
	"inlineMath",
]);

/** Containers whose children are phrasing; they are kept, with their children flattened. */
const PHRASING_PARENTS = new Set(["emphasis", "strong", "delete", "link", "linkReference"]);

const lineBreak = (): Html => ({ type: "html", value: "<br>" });

const needsFlattening = (nodes: readonly Mdast[]): boolean =>
	nodes.some((node) => {
		if (node.type === "break") {
			return true;
		}
		if (!PHRASING_TYPES.has(node.type)) {
			return true;
		}
		if ((node.type === "text" || node.type === "inlineCode") && node.value.includes("\n")) {
			return true;
		}
		return PHRASING_PARENTS.has(node.type) && "children" in node && needsFlattening(node.children);
	});

class CellBuilder {
	readonly out: PhrasingContent[] = [];
	#pendingBlock = false;

	/** Starts a new visual line when the previous block left content on the current one. */
	block(): void {
		if (this.#pendingBlock && this.out.length > 0) {
			this.out.push(lineBreak());
		}
		this.#pendingBlock = true;
	}

	add(nodes: readonly Mdast[]): void {
		for (const node of nodes) {
			this.#addOne(node);
		}
	}

	#addOne(node: Mdast): void {
		switch (node.type) {
			case "break":
				this.out.push(lineBreak());
				return;
			case "text":
				this.out.push({ type: "text", value: node.value.replace(/\s*\n\s*/g, " ") });
				return;
			case "inlineCode":
				this.#codeLines(node.value);
				return;
			case "code":
				this.block();
				this.#codeLines(node.value);
				return;
			case "math":
				this.block();
				this.out.push({ type: "inlineMath", value: node.value.replace(/\s*\n\s*/g, " ") });
				return;
			case "list":
				node.children.forEach((item, index) => {
					this.block();
					const marker = node.ordered ? `${(node.start ?? 1) + index}. ` : "- ";
					this.out.push({ type: "text", value: marker });
					this.#pendingBlock = false;
					this.add(item.children);
				});
				return;
			case "thematicBreak":
				return;
			default:
				this.#addContainer(node);
		}
	}

	#addContainer(node: Mdast): void {
		if (PHRASING_PARENTS.has(node.type) && "children" in node) {
			const inner = new CellBuilder();
			inner.add(node.children);
			this.out.push({ ...node, children: inner.out } as PhrasingContent);
			return;
		}
		if (PHRASING_TYPES.has(node.type)) {
			this.out.push(node as PhrasingContent);
			return;
		}
		if ("children" in node) {
			// paragraph, heading, blockquote, a nested table's rows and cells, …
			this.block();
			this.add(node.children);
		}
	}

	#codeLines(value: string): void {
		value.split("\n").forEach((line, index) => {
			if (index > 0) {
				this.out.push(lineBreak());
			}
			if (line.trim().length > 0) {
				this.out.push({ type: "inlineCode", value: line } satisfies InlineCode);
			}
		});
	}
}

/** Rewrites, in place, every cell of `table` that holds content a GFM cell cannot. */
export const flattenTableCells = (table: Table): void => {
	for (const row of table.children) {
		for (const cell of row.children) {
			if (!needsFlattening(cell.children)) {
				continue;
			}
			const builder = new CellBuilder();
			builder.add(cell.children as Mdast[]);
			cell.children = builder.out;
		}
	}
};

const hasMultilineCode = (nodes: readonly Mdast[]): boolean =>
	nodes.some(
		(node) =>
			(node.type === "code" && node.value.includes("\n")) || ("children" in node && hasMultilineCode(node.children)),
	);

/**
 * True when a table carries code samples that a GFM cell can only mangle.
 *
 * Side-by-side comparison tables ("Interface | Type", "Markdown | HTML") put a full code sample in
 * each cell. Flattened, the samples become `<br>`-joined inline code, which is unreadable and loses
 * the fence; such a table reads better as the sequence of blocks it really is.
 */
export const tableHasCodeSamples = (table: Table): boolean =>
	table.children.some((row) => row.children.some((cell) => hasMultilineCode(cell.children as Mdast[])));

/**
 * Lays a table out as blocks: each row's cells in order, each labelled with its column header.
 *
 * @param hasHeader - Whether the first row is a header row in the source. Without one there is
 * nothing to label cells with, and the first row is data like the rest.
 */
export const unfoldTable = (table: Table, hasHeader: boolean): RootContent[] => {
	const [first, ...rest] = table.children;
	const labels = hasHeader && first ? first.children.map((cell) => cell.children) : [];
	const rows = hasHeader ? rest : table.children;
	const out: RootContent[] = [];

	rows.forEach((row, rowIndex) => {
		if (rowIndex > 0) {
			out.push({ type: "thematicBreak" });
		}
		row.children.forEach((cell, cellIndex) => {
			const label = labels[cellIndex];
			if (label && label.length > 0) {
				out.push({ type: "paragraph", children: [{ type: "strong", children: label }] });
			}
			out.push(...asBlocks(cell.children as Mdast[]));
		});
	});

	return out;
};

/** Wraps runs of phrasing content in paragraphs so a cell's children are valid flow content. */
const asBlocks = (nodes: readonly Mdast[]): RootContent[] => {
	const blocks: RootContent[] = [];
	let run: PhrasingContent[] = [];
	const flush = () => {
		if (run.some((node) => node.type !== "text" || node.value.trim().length > 0)) {
			blocks.push({ type: "paragraph", children: run });
		}
		run = [];
	};

	for (const node of nodes) {
		if (PHRASING_TYPES.has(node.type) || node.type === "break") {
			run.push(node as PhrasingContent);
		} else {
			flush();
			blocks.push(node as RootContent);
		}
	}
	flush();
	return blocks;
};
