import type { Element } from "hast";
import { describe, expect, it } from "vitest";

import { findElement } from "../../utils/hast-fast";
import { parseHtml } from "../../utils/parse-html";
import { isLayoutTable } from "./layout-tables";

const tableOf = (html: string): Element => {
	const table = findElement(parseHtml(html, { fragment: true }), (element) => element.tagName === "table");
	if (!table) {
		throw new Error("no table");
	}
	return table;
};

const row = (...cells: string[]) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;

describe("isLayoutTable", () => {
	it("treats a heading alone in its row above data rows as a caption", () => {
		const table = tableOf(
			`<div><table>${row("<h3>Superior Room</h3>")}${row("Type", "Includes", "Guests", "Price")}${row(
				"Twin",
				"Breakfast",
				"2",
				"Ask",
			)}</table></div>`,
		);
		expect(isLayoutTable(table)).toBe(false);
	});

	it("still treats a heading next to other cells as page layout", () => {
		const table = tableOf(
			`<div><table>${row("<h1>Site</h1>", "menu")}${row("a", "b")}${row("c", "d")}${row("e", "f")}</table></div>`,
		);
		expect(isLayoutTable(table)).toBe(true);
	});

	it("still treats captioned single cells without data rows as page layout", () => {
		const table = tableOf(`<div><table>${row("<h2>Title</h2>")}${row("Body text of the page")}</table></div>`);
		expect(isLayoutTable(table)).toBe(true);
	});
});
