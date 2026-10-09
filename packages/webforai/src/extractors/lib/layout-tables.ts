/**
 * Layout tables: `<table>` used for page layout rather than data.
 *
 * Pages from the table-layout era nest the whole article inside layout tables. Converted as
 * tables, their cells become GFM table cells and the article is flattened into one row or lost.
 * The classification follows Readability's `_isDataTable` with two changes. A cell holding a
 * heading, a form or another table is page layout — except a heading alone in its row, which is how
 * pages caption the sections of a data table (a room type above its price rows). And a small grid
 * of short cells is data: Readability calls every table of ten cells or fewer layout, which
 * flattens specification tables ("Model No. | HT02G", "Flight Time | 21 mins") into loose lines.
 *
 * The second change comes from Defuddle (https://github.com/kepano/defuddle, MIT, © 2025 Steph
 * Ango; see THIRD_PARTY_NOTICES.md), which treats any multi-column table without nested tables as
 * data. Only its small-table case is taken, and only for short cells that are mostly not links,
 * because table-layout pages put a whole article, or a toolbar of links, into a two-by-two grid.
 */

import type { Element, ElementContent, Nodes as Hast, Parent } from "hast";

import { isElement, stringProperty } from "../../utils/hast-fast";

const DATA_MARKERS = new Set(["caption", "thead", "tfoot", "th", "col", "colgroup"]);
/**
 * Cell content that only page layout puts in a table cell. Paragraphs and lists are absent on
 * purpose: Sphinx wraps every data cell in a `<p>`, and infoboxes hold lists.
 */
const BLOCK_IN_CELL = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "table", "form"]);

const TABLE_PARTS = new Set(["tbody", "thead", "tfoot", "tr", "td", "th"]);
const TABLE_CONTEXT = new Set(["table", "tbody", "thead", "tfoot", "tr"]);

interface TableShape {
	rows: number;
	columns: number;
	dataMarker: boolean;
	blockInCell: boolean;
	/** Characters of text in the longest cell, whitespace collapsed. */
	longestCell: number;
	/** Characters of text in all cells, and in links within them. */
	text: number;
	linkText: number;
}

/**
 * Longest cell text a small table may have and still be data. Labels and values in a
 * specification table are a few words; a layout grid holds paragraphs.
 */
const MAX_SMALL_TABLE_CELL = 150;

/** Largest share of a small table's text that may be link text for the table to be data. */
const MAX_SMALL_TABLE_LINK_SHARE = 0.5;

const collapsedLength = (text: string): number => text.replace(/\s+/g, " ").trim().length;

/** Text length of a cell and of the links in it, whitespace collapsed, not counting nested tables. */
const cellText = (cell: Element): { text: number; linkText: number } => {
	let text = "";
	let linkText = "";
	const visit = (node: Element, inLink: boolean): void => {
		for (const child of node.children) {
			if (child.type === "text") {
				text += child.value;
				if (inLink) {
					linkText += child.value;
				}
			} else if (isElement(child) && child.tagName !== "table") {
				visit(child, inLink || child.tagName === "a");
			}
		}
	};
	visit(cell, false);
	return { text: collapsedLength(text), linkText: collapsedLength(linkText) };
};

/** Cells of a row (`td`/`th` children). */
const cellsOf = (row: Element): Element[] =>
	row.children.filter((cell): cell is Element => isElement(cell) && (cell.tagName === "td" || cell.tagName === "th"));

const HEADING = /^h[1-6]$/;

/** Adds a row and its cells' text to the table's totals; true when the row has a single cell. */
const measureRow = (shape: TableShape, row: Element): boolean => {
	const cells = cellsOf(row);
	shape.rows += 1;
	shape.columns = Math.max(shape.columns, cells.length);
	for (const cell of cells) {
		const { text, linkText } = cellText(cell);
		shape.longestCell = Math.max(shape.longestCell, text);
		shape.text += text;
		shape.linkText += linkText;
	}
	return cells.length === 1;
};

const shapeOf = (table: Element): TableShape => {
	const shape: TableShape = {
		rows: 0,
		columns: 0,
		dataMarker: false,
		blockInCell: false,
		longestCell: 0,
		text: 0,
		linkText: 0,
	};
	let captionHeadings = 0;
	/** Block content in a cell is layout evidence, unless it is a heading alone in its row. */
	const noteBlockInCell = (tag: string, aloneInRow: boolean): void => {
		if (HEADING.test(tag) && aloneInRow) {
			captionHeadings += 1;
		} else {
			shape.blockInCell = true;
		}
	};
	const visit = (node: Element, inCell: boolean, aloneInRow: boolean): void => {
		for (const child of node.children) {
			if (!isElement(child)) {
				continue;
			}
			const tag = child.tagName;
			if (tag === "table") {
				// Nested tables are evidence of layout; their own rows are not this table's.
				shape.blockInCell = shape.blockInCell || inCell;
				continue;
			}
			if (DATA_MARKERS.has(tag)) {
				shape.dataMarker = true;
			}
			const alone = tag === "tr" ? measureRow(shape, child) : aloneInRow;
			if (inCell && BLOCK_IN_CELL.has(tag)) {
				noteBlockInCell(tag, aloneInRow);
			}
			visit(child, inCell || tag === "td" || tag === "th", alone);
		}
	};
	visit(table, false, false);
	// Captions only make sense above rows of data: a table of nothing but captioned single cells is
	// still layout.
	if (captionHeadings > 0 && (shape.columns < 2 || shape.rows - captionHeadings < 2)) {
		shape.blockInCell = true;
	}
	return shape;
};

export const isLayoutTable = (table: Element): boolean => {
	const role = stringProperty(table, "role");
	if (role === "presentation" || role === "none" || stringProperty(table, "datatable") === "0") {
		return true;
	}
	const shape = shapeOf(table);
	if (shape.blockInCell) {
		return true;
	}
	if (shape.dataMarker) {
		return false;
	}
	if (shape.rows <= 1 || shape.columns <= 1) {
		return true;
	}
	if (shape.rows >= 10 || shape.columns > 4) {
		return false;
	}
	if (shape.rows * shape.columns > 10) {
		return false;
	}
	// A small table is data when it reads as labels and values: short cells, mostly not links. A
	// grid of links ("Article Tools", subscription offers) is a toolbar laid out with a table.
	const linkShare = shape.text === 0 ? 1 : shape.linkText / shape.text;
	return shape.longestCell > MAX_SMALL_TABLE_CELL || linkShare > MAX_SMALL_TABLE_LINK_SHARE;
};

/** Cell contents of a layout table, each cell as a `div`, in reading order. */
const unwrap = (table: Element): Element => {
	const cells: ElementContent[] = [];
	const collect = (node: Element): void => {
		for (const child of node.children) {
			if (!isElement(child)) {
				continue;
			}
			if (child.tagName === "td" || child.tagName === "th") {
				cells.push({ type: "element", tagName: "div", properties: {}, children: child.children });
			} else if (child.tagName !== "table") {
				collect(child);
			}
		}
	};
	collect(table);
	return { type: "element", tagName: "div", properties: {}, children: cells };
};

/**
 * Replaces every layout table under `root` with its cells' contents, innermost first.
 *
 * Runs bottom-up so a layout table nested in a data table's cell is resolved before the outer
 * table is classified.
 */
export const unwrapLayoutTables = (root: Hast): void => {
	const visit = (parent: Parent): void => {
		const parentTag = isElement(parent) ? parent.tagName : "";
		for (let index = 0; index < parent.children.length; index++) {
			const child = parent.children[index];
			if (!isElement(child)) {
				continue;
			}
			// Fragment parsing drops a document's leading `<table>` start tag and leaves its rows
			// and cells at the top level. Without their table they are just containers.
			if (TABLE_PARTS.has(child.tagName) && !TABLE_CONTEXT.has(parentTag)) {
				child.tagName = "div";
			}
			visit(child);
			if (child.tagName === "table" && isLayoutTable(child)) {
				parent.children[index] = unwrap(child);
			}
		}
	};
	if ("children" in root) {
		visit(root as Parent);
	}
};
