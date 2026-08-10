import type { Element, Nodes as Hast } from "hast";
import { fromHtml } from "hast-util-from-html";
import { toString as hastToString } from "hast-util-to-string";
import { describe, expect, it } from "vitest";

import {
	MetricsCollector,
	classList,
	cloneHast,
	collectElements,
	findElement,
	isElement,
	matchString,
	numericProperty,
	pruneInPlace,
	stringProperty,
	walk,
} from "./hast-fast";

const parse = (html: string): Hast => fromHtml(html, { fragment: true });

describe("MetricsCollector", () => {
	it("counts text length the same way hast-util-to-string does", () => {
		const tree = parse("<div><p>Hello</p><p> world!</p></div>");
		expect(new MetricsCollector().textLength(tree)).toBe(hastToString(tree).length);
	});

	it("attributes anchor text to the link budget of every ancestor", () => {
		const tree = parse("<div><p>1234567890</p><p><a href='/x'>link</a></p></div>");
		const collector = new MetricsCollector();

		expect(collector.metrics(tree).text).toBe(14);
		expect(collector.metrics(tree).link).toBe(4);
		expect(collector.linkDensity(tree)).toBeCloseTo(4 / 14);
	});

	it("reports a link density of 1 for a pure navigation list", () => {
		const tree = parse("<nav><a href='/a'>Home</a><a href='/b'>About</a></nav>");
		expect(new MetricsCollector().linkDensity(tree)).toBe(1);
	});

	it("returns 0 density rather than NaN for empty subtrees", () => {
		expect(new MetricsCollector().linkDensity(parse("<div></div>"))).toBe(0);
	});

	it("ignores script and style bodies so they cannot inflate a container's score", () => {
		const tree = parse("<div><script>var aVeryLongVariableName = 1;</script><p>hi</p></div>");
		expect(new MetricsCollector().metrics(tree).text).toBe(2);
	});

	it("counts commas across ASCII and CJK punctuation", () => {
		const tree = parse("<p>a, b、c，d</p>");
		expect(new MetricsCollector().metrics(tree).commas).toBe(3);
	});

	it("counts paragraph-like descendants and elements", () => {
		const tree = parse("<div><p>a</p><ul><li>b</li><li>c</li></ul></div>");
		const metrics = new MetricsCollector().metrics(tree);

		expect(metrics.paragraphs).toBe(3); // one <p> and two <li>
		expect(metrics.elements).toBe(5); // div, p, ul, li, li
	});

	it("memoises repeated reads of the same node", () => {
		const tree = parse("<div><p>hello</p></div>");
		const collector = new MetricsCollector();
		expect(collector.metrics(tree)).toBe(collector.metrics(tree));
	});
});

describe("pruneInPlace", () => {
	it("removes rejected nodes without cloning the tree", () => {
		const tree = parse("<div><p>keep</p><span>drop</span><p>keep2</p></div>");
		const result = pruneInPlace(tree, (node) => !(isElement(node) && node.tagName === "span"));

		expect(result).toBe(tree);
		expect(hastToString(tree)).toBe("keepkeep2");
	});

	it("skips the whole subtree of a rejected node", () => {
		const tree = parse("<div><aside><p>boilerplate</p></aside><p>content</p></div>");
		const seen: string[] = [];

		pruneInPlace(tree, (node) => {
			if (isElement(node)) {
				seen.push(node.tagName);
				return node.tagName !== "aside";
			}
			return true;
		});

		expect(hastToString(tree)).toBe("content");
		// The <p> inside the rejected <aside> is never visited.
		expect(seen).toEqual(["div", "aside", "p"]);
	});

	it("keeps the root itself even when it would not pass the predicate", () => {
		const tree = parse("<div><p>x</p></div>");
		expect(pruneInPlace(tree, () => false)).toBe(tree);
	});
});

describe("walk", () => {
	it("visits nodes in document order", () => {
		const tree = parse("<div><p>a</p><section><span>b</span></section></div>");
		const tags: string[] = [];

		walk(tree, (node) => {
			if (isElement(node)) {
				tags.push(node.tagName);
			}
		});

		expect(tags).toEqual(["div", "p", "section", "span"]);
	});

	it("skips a subtree when the visitor returns false", () => {
		const tree = parse("<div><section><span>skipped</span></section><p>seen</p></div>");
		const tags: string[] = [];

		walk(tree, (node) => {
			if (!isElement(node)) {
				return;
			}
			tags.push(node.tagName);
			if (node.tagName === "section") {
				return false;
			}
		});

		expect(tags).toEqual(["div", "section", "p"]);
	});
});

describe("element helpers", () => {
	it("normalises both the array and string shapes of className", () => {
		const arrayShape = { type: "element", tagName: "div", properties: { className: ["a", "b"] }, children: [] };
		const stringShape = { type: "element", tagName: "div", properties: { className: "a  b" }, children: [] };

		expect(classList(arrayShape as Element)).toEqual(["a", "b"]);
		expect(classList(stringShape as Element)).toEqual(["a", "b"]);
	});

	it("builds a match string from tag, id and classes", () => {
		const tree = parse("<div id='main' class='content wide'></div>");
		const div = findElement(tree, (element) => element.tagName === "div");

		// biome-ignore lint/style/noNonNullAssertion: asserted by the query above
		expect(matchString(div!)).toBe("div main content wide");
	});

	it("returns just the tag name when there is no id or class", () => {
		const tree = parse("<div></div>");
		const div = findElement(tree, (element) => element.tagName === "div");
		// biome-ignore lint/style/noNonNullAssertion: asserted by the query above
		expect(matchString(div!)).toBe("div");
	});

	it("collects elements matching a predicate", () => {
		const tree = parse("<div><a href='/1'>1</a><p>x</p><a href='/2'>2</a></div>");
		expect(collectElements(tree, (element) => element.tagName === "a")).toHaveLength(2);
	});

	it("parses numeric properties from the string form attributes arrive in", () => {
		const tree = parse("<div data-rwidth='640.5' data-rheight='' ></div>");
		const div = findElement(tree, (element) => element.tagName === "div");

		// biome-ignore lint/style/noNonNullAssertion: asserted by the query above
		expect(numericProperty(div!, "data-rwidth")).toBe(640.5);
		// biome-ignore lint/style/noNonNullAssertion: asserted by the query above
		expect(numericProperty(div!, "data-rheight")).toBeUndefined();
	});

	it("joins token-list properties into a string", () => {
		const tree = parse("<a href='/x' rel='noopener noreferrer'>x</a>");
		const anchor = findElement(tree, (element) => element.tagName === "a");
		// biome-ignore lint/style/noNonNullAssertion: asserted by the query above
		expect(stringProperty(anchor!, "rel")).toBe("noopener noreferrer");
	});
});

describe("cloneHast", () => {
	it("produces an independent copy", () => {
		const tree = parse("<div><p>original</p></div>");
		const copy = cloneHast(tree);

		pruneInPlace(copy, (node) => !(isElement(node) && node.tagName === "p"));

		expect(hastToString(tree)).toBe("original");
		expect(hastToString(copy)).toBe("");
	});

	it("copies trees whose properties use a null prototype", () => {
		const tree = parse("<div class='a'><p>x</p></div>");
		walk(tree, (node) => {
			if (isElement(node)) {
				node.properties = Object.assign(Object.create(null), node.properties);
			}
		});

		expect(hastToString(cloneHast(tree))).toBe("x");
	});
});
