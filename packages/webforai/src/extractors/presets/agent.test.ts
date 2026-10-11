import { describe, expect, it } from "vitest";
import { htmlToMarkdown, htmlToMarkdownWithMetadata } from "../../html-to-markdown";
import { parseHtml } from "../../utils/parse-html";
import { agentExtractor, commentsExtractor, createAgentAutoExtractor, createAgentExtractor } from "./agent";
import { readerExtractor } from "./auto";

const page = `<html><head><title>How to bake bread</title></head><body>
<header><nav class="global-nav"><a href="/">Home</a> <a href="/recipes">Recipes</a> <a href="/about">About</a></nav></header>
<nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/recipes/bread">Bread</a></nav>
<article><h1>How to bake bread</h1>
<p>Bread needs flour, water, salt and yeast, mixed and kneaded, then left to rise for several hours before baking.</p>
<p>Bake at 230 degrees for about forty minutes, until the crust is deep brown and the loaf sounds hollow, with a <a href="/tips">few tips</a>.</p></article>
<div class="pagination"><a href="/recipes/bread/2" rel="next">Next recipe</a></div>
<aside class="related-posts"><h2>Related posts</h2><ul><li><a href="/sourdough">Sourdough starter</a></li><li><a href="/rye">Rye bread</a></li></ul></aside>
<div class="share"><a href="https://twitter.com/intent/tweet">Share on Twitter</a></div>
<section id="comments" class="comments"><h2>3 comments</h2><ol class="comment-list">
<li class="comment"><div class="comment-author">Mia</div><div class="comment-body"><p>I added a spoonful of honey to the dough and the crust browned beautifully, thank you for this recipe.</p></div></li>
<li class="comment"><div class="comment-author">Tom</div><div class="comment-body"><p>Does this work with whole wheat flour, or does the dough need more water and a longer rise?</p></div></li>
</ol></section>
</body></html>`;

const convert = (extractors: typeof agentExtractor) =>
	htmlToMarkdown(page, { baseUrl: "https://example.com/recipes/bread/1", extractors });

describe("agentExtractor", () => {
	it("keeps the reader-mode content and appends the page's other links", () => {
		const [body, links] = convert(agentExtractor).split("## Links");

		expect(body.trim()).toBe(convert(readerExtractor).trim());
		expect(links).toContain("[Next recipe](https://example.com/recipes/bread/2)");
		expect(links).not.toContain("Share on Twitter");
	});

	it("groups links by role (class and aria hints)", () => {
		const links = convert(createAgentExtractor({ roleModels: null })).split("## Links")[1];

		expect(links).toContain("### Related");
		expect(links).toContain("[Sourdough starter](https://example.com/sourdough)");
		expect(links).toContain("[Next recipe](https://example.com/recipes/bread/2)");
		expect(links).toContain("[Recipes](https://example.com/recipes)");
	});

	it("lists each link once and leaves out the main content's own links", () => {
		const links = convert(agentExtractor).split("## Links")[1];

		expect(links.match(/\(https:\/\/example\.com\/\)/g)?.length ?? 0).toBeLessThanOrEqual(1);
		expect(links).not.toContain("few tips");
	});

	it("lists only the requested roles, in the requested order", () => {
		const markdown = convert(createAgentExtractor({ roles: ["pagination"], roleModels: null }));

		expect(markdown).toContain("### Pagination");
		expect(markdown).not.toContain("### Related");
		expect(markdown).not.toContain("### Site navigation");
	});
});

describe("agentExtractor card links", () => {
	it("lists links that wrap block elements", () => {
		const html = page.replace(
			'<aside class="related-posts">',
			'<aside class="related-posts"><a href="/focaccia"><div><h3>Focaccia</h3><p>A flat oven-baked bread.</p></div></a>',
		);
		const links = htmlToMarkdown(html, {
			baseUrl: "https://example.com/recipes/bread/1",
			extractors: createAgentExtractor({ roleModels: null }),
		}).split("## Links")[1];

		expect(links).toContain("(https://example.com/focaccia)");
	});
});

describe("agent mode on pages a site adapter claims", () => {
	const wordpress = `<html><head><title>Sourdough at home</title><meta name="generator" content="WordPress 6.6"></head><body>
<header><nav class="main-nav"><a href="/">Home</a> <a href="/recipes/">Recipes</a></nav></header>
<article><h1>Sourdough at home</h1><div class="entry-content">
<p>A starter is flour and water left to ferment for a week, fed every day until it doubles reliably after each feeding.</p>
<p>Mix the dough, fold it four times over two hours, shape it, and leave it in the fridge overnight before baking it hot.</p>
<div class="jp-relatedposts"><h3>Related</h3><a href="/rye-bread/">Rye bread</a></div>
</div>
<nav class="pagination"><a href="/focaccia/" rel="prev">Previous post: Focaccia</a> <a href="/brioche/" rel="next">Next post: Brioche</a></nav>
</article>
</body></html>`;

	it("keeps the adapter's content and lists the page's other links", () => {
		const markdown = htmlToMarkdown(wordpress, {
			baseUrl: "https://bakery.example/sourdough/",
			extractors: createAgentAutoExtractor({ roleModels: null }),
		});
		const [body, links] = markdown.split("## Links");

		expect(body).toContain("fold it four times");
		expect(body).not.toContain("Rye bread");
		expect(links).toContain("(https://bakery.example/brioche/)");
		expect(links).toContain("(https://bakery.example/rye-bread/)");
	});

	it("reports the adapter, and leaves comments to it", () => {
		const html = wordpress.replace(
			"</article>",
			`</article><section id="comments" class="comments"><ol class="comment-list"><li class="comment"><div class="comment-body"><p>I fed mine twice a day in summer and it doubled in four hours, much faster than in winter.</p></div></li></ol></section>`,
		);
		const { markdown, extraction } = htmlToMarkdownWithMetadata(html, {
			url: "https://bakery.example/sourdough/",
			extractors: createAgentAutoExtractor({ roleModels: null }),
		});

		expect(extraction?.extractor).toBe("adapter");
		expect(markdown).not.toContain("## Comments");
	});

	it("skips the adapters with adapters: false", () => {
		const { extraction } = htmlToMarkdownWithMetadata(wordpress, {
			url: "https://bakery.example/sourdough/",
			extractors: createAgentAutoExtractor({ roleModels: null, adapters: false }),
		});

		expect(extraction?.extractor).not.toBe("adapter");
	});
});

describe("agentExtractor on a tree the caller owns", () => {
	it("leaves the tree unchanged", () => {
		const tree = parseHtml(page, { fragment: true });
		const before = JSON.stringify(tree);
		htmlToMarkdown(tree, { baseUrl: "https://example.com/recipes/bread/1", extractors: agentExtractor });

		expect(JSON.stringify(tree)).toBe(before);
	});
});

describe("agentExtractor hidden menus", () => {
	const article = `<article><h1>Rye bread</h1>
<p>Rye flour holds water differently from wheat, so the dough stays sticky and is shaped with wet hands rather than kneaded.</p>
<p>Bake it in a tin for an hour and let it rest a full day before slicing, or the crumb will be gummy in the middle.</p></article>`;
	const pageWith = (extra: string, wrapper = "") =>
		`<html><head><title>Rye bread</title></head><body>${wrapper ? `<div class="${wrapper}">` : ""}
<header><nav class="main-nav"><ul><li><a href="/">Home</a></li><li><a href="/products">Products</a>
<ul class="sub-menu" hidden><li><a href="/products/rye-flour">Rye flour</a></li><li><a href="/products/tins">Baking tins</a></li></ul></li></ul></nav>${extra}</header>
${article}${wrapper ? "</div>" : ""}</body></html>`;
	const linksOf = (html: string) =>
		htmlToMarkdown(html, {
			url: "https://bakery.example/rye/",
			baseUrl: "https://bakery.example/rye/",
			extractors: createAgentExtractor({ roleModels: null }),
		}).split("## Links")[1] ?? "";

	it("lists the links of a collapsed dropdown", () => {
		expect(linksOf(pageWith(""))).toContain("[Rye flour](https://bakery.example/products/rye-flour)");
	});

	it("leaves out account, sign-in and legal links", () => {
		const links = linksOf(
			pageWith(`<div class="account-menu" style="display:none"><a href="/account">My account</a> <a href="/logout">Sign out</a> <a href="/account/delete">Delete account</a> <a href="/privacy-policy">Privacy</a></div>
<div class="modal search-menu" hidden><a href="/login">Log in</a></div>`),
		);

		expect(links).toContain("Rye flour");
		for (const text of ["My account", "Sign out", "Delete account", "Privacy", "Log in"]) {
			expect(links).not.toContain(`[${text}]`);
		}
	});

	it("leaves out consent banners", () => {
		const links = linksOf(
			pageWith(
				`<div id="cookie-banner" hidden><a href="/how-we-use-data">Learn more</a> <a href="/partners">Our partners</a></div>`,
			),
		);

		expect(links).not.toContain("Learn more");
		expect(links).not.toContain("Our partners");
	});

	it("does not take a page-wide wrapper for a menu", () => {
		const html = pageWith("", "site has-main-navigation").replace(
			"</article>",
			`<div class="tab-panel" hidden><a href="/rye/second-tab">Second tab</a></div></article>`,
		);

		expect(linksOf(html)).not.toContain("Second tab");
	});

	it("lists at most 200 links of a hidden mega menu", () => {
		const items = Array.from({ length: 3000 }, (_, i) => `<li><a href="/c/${i}">Category ${i}</a></li>`).join("");
		const links = linksOf(pageWith(`<div class="mega-menu" hidden><ul>${items}</ul></div>`));

		// The dropdown's two links come first and count towards the 200.
		expect(links.match(/\[Category \d+\]/g)?.length).toBe(198);
	});

	it("leaves out share links and links that lead to no page", () => {
		const links = linksOf(
			pageWith(`<ul class="dropdown-menu" hidden>
<li><a href="https://www.linkedin.com/sharing/share-offsite/?url=x">LinkedIn</a></li>
<li><a href="//www.facebook.com/sharer/sharer.php?u=x">Facebook</a></li>
<li><a href="https://m.facebook.com/sharer.php?u=x">Facebook mobile</a></li>
<li><a href="https://x.com/share?url=x">X</a></li>
<li><a href="https://bsky.app/intent/compose?text=x">Bluesky</a></li>
<li><a href="vbscript:msgbox">VB</a></li><li><a href="sms:+15550100">Text us</a></li>
<li><a href="/recipes/rye">Rye recipes</a></li></ul>`),
		);

		expect(links).toContain("Rye recipes");
		for (const text of ["LinkedIn", "Facebook", "Facebook mobile", "X", "Bluesky", "VB", "Text us"]) {
			expect(links).not.toContain(`[${text}]`);
		}
	});

	it("lists a link once, however its href is written", () => {
		const links = linksOf(
			pageWith(
				`<ul class="dropdown-menu" hidden><li><a href="https://bakery.example/products/rye-flour">Rye flour again</a></li></ul>`,
			),
		);

		expect(links.match(/\(https:\/\/bakery\.example\/products\/rye-flour\)/g)?.length).toBe(1);
	});
});

describe("agentExtractor keepScale", () => {
	it("rejects a scale that is not a finite number above 0", () => {
		for (const keepScale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => createAgentExtractor({ keepScale })).toThrow(RangeError);
		}
		expect(() => createAgentExtractor({ keepScale: 0.5 })).not.toThrow();
	});

	it("has no effect without role models", () => {
		expect(convert(createAgentExtractor({ roleModels: null, keepScale: 0.1 }))).toBe(
			convert(createAgentExtractor({ roleModels: null })),
		);
	});
});

describe("commentsExtractor", () => {
	it("keeps the reader-mode content and lists no links", () => {
		const markdown = convert(commentsExtractor);

		expect(markdown.split("## Comments")[0].trim()).toBe(convert(readerExtractor).trim());
		expect(markdown).not.toContain("## Links");
	});

	it("appends reader comments after the content (class and aria hints)", () => {
		const [body, comments] = convert(createAgentExtractor({ roles: [], roleModels: null })).split("## Comments");

		expect(body).not.toContain("spoonful of honey");
		expect(comments).toContain("spoonful of honey");
		expect(comments).toContain("whole wheat flour");
		expect(comments).not.toContain("## Links");
	});
});
