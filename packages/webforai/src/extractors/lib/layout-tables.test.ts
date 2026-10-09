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

	it("keeps a small specification table of short cells as data", () => {
		const table = tableOf(
			`<div><table>${row("Model No.", "HT02G")}${row("Product Weight:", "19g")}${row(
				"Flight Time",
				"21 mins (3 batteries total)",
			)}${row("Size:", "115*80*45mm")}${row("Transmitter operating frequency", "2.4GHz")}</table></div>`,
		);
		expect(isLayoutTable(table)).toBe(false);
	});

	it("still treats a small grid holding prose as page layout", () => {
		const prose = "The article body sits in this cell, as table-layout pages did. ".repeat(4);
		const table = tableOf(`<div><table>${row("Navigation", prose)}${row("Footer", "Contact")}</table></div>`);
		expect(isLayoutTable(table)).toBe(true);
	});

	it("still treats a single row of short cells as page layout", () => {
		const table = tableOf(`<div><table>${row("Home", "About", "Contact")}</table></div>`);
		expect(isLayoutTable(table)).toBe(true);
	});

	it("still treats a small grid of links as page layout", () => {
		const link = (text: string) => `<a href="/${text}">${text}</a>`;
		const table = tableOf(
			`<div><table>${row("Article Tools", "")}${row(link("Email a Friend"), link("Printer Friendly"))}${row(
				link("RSS"),
				link("Save This Page"),
			)}</table></div>`,
		);
		expect(isLayoutTable(table)).toBe(true);
	});

	it("keeps a specification table whose values are links as data", () => {
		const table = tableOf(
			`<div><table>${row("Brand", '<a href="/b">Holyton</a>')}${row("Color", "gold")}${row(
				"Weight",
				"19 Grams",
			)}</table></div>`,
		);
		expect(isLayoutTable(table)).toBe(false);
	});
});
