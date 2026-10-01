import { fromHtml } from "hast-util-from-html";
import { describe, expect, it } from "vitest";

import { ancestorsOf, describeElement, segmentBlocks } from "./blocks";

const blocksOf = (html: string) => segmentBlocks(fromHtml(html, { fragment: true }));

describe("segmentBlocks", () => {
	it("splits inline runs around nested blocks", () => {
		const blocks = blocksOf("<div>Intro <b>x</b><p>Para</p> tail</div>");
		expect(blocks.map((block) => [block.owner.tagName, block.text])).toEqual([
			["div", "Intro x"],
			["p", "Para"],
			["div", "tail"],
		]);
	});

	it("counts link text, including blocks nested in a link", () => {
		const [first, second] = blocksOf('<p>See <a href="/a">the docs</a> now</p><a href="/b"><div>Card title</div></a>');
		expect(first.linkChars).toBe("the docs".length);
		expect(first.links).toBe(1);
		expect(second.linkChars).toBe("Card title".length);
	});

	it("keeps preformatted text whole and skips scripts", () => {
		const blocks = blocksOf("<pre><code>a\n  b</code></pre><script>x()</script>");
		expect(blocks).toHaveLength(1);
		expect(blocks[0].text).toBe("a\n  b");
	});

	it("emits image-only blocks and records ancestors", () => {
		const [block] = blocksOf('<article class="post"><figure><img src="a.png"></figure></article>');
		expect(block.images).toBe(1);
		expect(ancestorsOf(block).map((element) => element.tagName)).toEqual(["article", "figure"]);
		expect(describeElement(ancestorsOf(block)[0])).toBe("article.post");
		expect(block.frame.depth).toBe(2);
	});

	it("stops at the block limit", () => {
		expect(blocksOf("<p>a</p>".repeat(50)).length).toBe(50);
		expect(segmentBlocks(fromHtml("<p>a</p>".repeat(50), { fragment: true }), 10)).toHaveLength(10);
	});
});
