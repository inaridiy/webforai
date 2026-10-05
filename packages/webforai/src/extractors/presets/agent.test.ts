import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../../html-to-markdown";
import { agentExtractor, createAgentExtractor } from "./agent";
import { readabilityExtractor } from "./auto";

const page = `<html><head><title>How to bake bread</title></head><body>
<header><nav class="global-nav"><a href="/">Home</a> <a href="/recipes">Recipes</a> <a href="/about">About</a></nav></header>
<nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/recipes/bread">Bread</a></nav>
<article><h1>How to bake bread</h1>
<p>Bread needs flour, water, salt and yeast, mixed and kneaded, then left to rise for several hours before baking.</p>
<p>Bake at 230 degrees for about forty minutes, until the crust is deep brown and the loaf sounds hollow, with a <a href="/tips">few tips</a>.</p></article>
<div class="pagination"><a href="/recipes/bread/2" rel="next">Next recipe</a></div>
<aside class="related-posts"><h2>Related posts</h2><ul><li><a href="/sourdough">Sourdough starter</a></li><li><a href="/rye">Rye bread</a></li></ul></aside>
<div class="share"><a href="https://twitter.com/intent/tweet">Share on Twitter</a></div>
</body></html>`;

const convert = (extractors: typeof agentExtractor) =>
	htmlToMarkdown(page, { baseUrl: "https://example.com/recipes/bread/1", extractors });

describe("agentExtractor", () => {
	it("keeps the readability content and appends the page's other links", () => {
		const [body, links] = convert(agentExtractor).split("## Links");

		expect(body.trim()).toBe(convert(readabilityExtractor).trim());
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
