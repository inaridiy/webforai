/**
 * Layout tables: `<table>` used for page layout rather than data.
 *
 * Pages from the table-layout era nest the whole article inside layout tables. Converted as
 * tables, their cells become GFM table cells and the article is flattened into one row or lost.
 * The classification follows Readability's `_isDataTable` with one addition: a cell holding a
 * heading, a form or another table is page layout — except a heading alone in its row, which is how
 * pages caption the sections of a data table (a room type above its price rows).
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
}

/** Cells of a row (`td`/`th` children). */
const cellsOf = (row: Element): Element[] =>
	row.children.filter((cell): cell is Element => isElement(cell) && (cell.tagName === "td" || cell.tagName === "th"));

const HEADING = /^h[1-6]$/;

const shapeOf = (table: Element): TableShape => {
	const shape: TableShape = { rows: 0, columns: 0, dataMarker: false, blockInCell: false };
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
			let alone = aloneInRow;
			if (tag === "tr") {
				shape.rows += 1;
				const cells = cellsOf(child).length;
				shape.columns = Math.max(shape.columns, cells);
				alone = cells === 1;
			}
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
	return shape.rows * shape.columns <= 10;
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
