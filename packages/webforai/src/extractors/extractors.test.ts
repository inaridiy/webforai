import { describe, expect, it } from "vitest";

import { htmlToMarkdown } from "../html-to-markdown";

/** Enough prose for the extractor to accept a container as the article body. */
const filler = (words = 120): string => `<p>${"Sentence with, some prose. ".repeat(words)}</p>`;

const article = (body: string): string => `<html lang="en"><body><article>${filler()}${body}</article></body></html>`;

describe("preformatted content", () => {
	// Syntax highlighters emit inter-token spacing as whitespace-only spans. Those measure as
	// zero-length text, and dropping them as "empty wrappers" silently corrupts every code
	// sample on a documentation page.
	const highlighted = `<pre><code class="language-ts"><span class="k">let</span><span> </span><span class="v">obj</span><span>: </span><span class="t">any</span><span> = </span><span class="n">1</span></code></pre>`;

	it("keeps whitespace between highlighted tokens", () => {
		expect(htmlToMarkdown(article(highlighted))).toContain("let obj: any = 1");
	});

	it("does not run tokens together", () => {
		expect(htmlToMarkdown(article(highlighted))).not.toContain("letobj");
	});

	it("matches the unextracted conversion of the same block", () => {
		const extracted = htmlToMarkdown(article(highlighted));
		const raw = htmlToMarkdown(highlighted, { extractors: false });

		const codeOf = (markdown: string): string => markdown.slice(markdown.indexOf("```"));
		expect(codeOf(extracted).trim()).toBe(codeOf(raw).trim());
	});

	it("preserves indentation across lines", () => {
		const yaml = "<pre><code>kind: Pod\n<span>  </span>name: nginx</code></pre>";
		expect(htmlToMarkdown(article(yaml))).toContain("  name: nginx");
	});

	it("still drops empty wrappers outside preformatted regions", () => {
		const markdown = htmlToMarkdown(article("<p></p><span>  </span><p>Real trailing text here.</p>"));
		expect(markdown).toContain("Real trailing text here.");
		expect(markdown).not.toMatch(/\n{4,}/);
	});
});

describe("article selection", () => {
	it("keeps the article body and drops navigation", () => {
		const html = `<html lang="en"><body>
			<nav><a href="/a">Home</a><a href="/b">About</a><a href="/c">Contact</a></nav>
			<article>${filler()}</article>
			<footer><a href="/x">Privacy</a><a href="/y">Terms</a></footer>
		</body></html>`;
		const markdown = htmlToMarkdown(html);

		expect(markdown).toContain("Sentence with, some prose.");
		expect(markdown).not.toContain("Privacy");
		expect(markdown).not.toContain("About");
	});

	it("falls back to the whole document rather than returning nothing", () => {
		const html = "<html lang='en'><body><div><span>Only a fragment of text.</span></div></body></html>";
		expect(htmlToMarkdown(html)).toContain("Only a fragment of text.");
	});

	it("does not mutate a HAST tree supplied by the caller", async () => {
		const { fromHtml } = await import("hast-util-from-html");
		const tree = fromHtml(
			`<html lang="en"><body><nav><a href="/a">Nav</a></nav><article>${filler()}</article></body></html>`,
		);
		const before = JSON.stringify(tree);

		htmlToMarkdown(tree);

		expect(JSON.stringify(tree)).toBe(before);
	});
});

describe("tree ownership", () => {
	// Adapters prune their selected container in place. Before this was handled, converting a
	// caller-supplied tree that an adapter claimed silently destroyed the caller's data.
	it("does not mutate a caller tree when a site adapter claims the page", async () => {
		const { fromHtml } = await import("hast-util-from-html");
		const tree = fromHtml(
			`<html lang="en"><body><div class="mw-parser-output"><p>${"Wiki prose, with commas. ".repeat(
				40,
			)}</p><span class="mw-editsection">[edit]</span></div></body></html>`,
		);
		const before = JSON.stringify(tree);

		htmlToMarkdown(tree, { url: "https://en.wikipedia.org/wiki/Example" });

		expect(JSON.stringify(tree)).toBe(before);
	});

	it("still applies the adapter's own cleanup to the output", () => {
		const html = `<html lang="en"><body><div class="mw-parser-output"><p>${"Wiki prose, with commas. ".repeat(
			40,
		)}</p><span class="mw-editsection">[edit]</span></div></body></html>`;

		expect(htmlToMarkdown(html, { url: "https://en.wikipedia.org/wiki/Example" })).not.toContain("[edit]");
	});
});

describe("lazily-loaded images via data-srcset", () => {
	// `data-srcset` is stored by HAST as `dataSrcset`; a raw key lookup never matched it.
	it("resolves an image whose candidates live in data-srcset", () => {
		const markdown = htmlToMarkdown(article("<p><img data-srcset='/small.png 320w, /large.png 1280w' alt='S'></p>"));
		expect(markdown).toContain("![S](/large.png)");
	});

	it("treats a base64 placeholder as a placeholder regardless of image format", () => {
		const html = article(
			"<p><img src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' data-src='/real.png' alt='P'></p>",
		);
		expect(htmlToMarkdown(html)).toContain("![P](/real.png)");
	});
});

describe("noscript image fallbacks", () => {
	// The standard lazy-loading pattern is a placeholder followed by the real image in
	// <noscript>. Removing <noscript> as non-content discards the real one.
	const lazyFigure =
		'<figure><img src="data:image/gif;base64,R0lGOD" alt="Ph"><noscript><img src="/real.jpg" alt="Real"></noscript></figure>';

	it("recovers the image hidden inside noscript", () => {
		expect(htmlToMarkdown(article(lazyFigure))).toContain("![Real](/real.jpg)");
	});

	it("drops the placeholder the noscript was compensating for", () => {
		expect(htmlToMarkdown(article(lazyFigure))).not.toContain("![Ph]");
	});

	it("leaves noscript without images alone", () => {
		const markdown = htmlToMarkdown(article("<noscript><p>Enable JavaScript</p></noscript>"));
		expect(markdown).not.toContain("Enable JavaScript");
	});
});

describe("presentational roles", () => {
	// role="presentation" marks decorative structure, not decorative content.
	it("keeps text inside a role=presentation wrapper", () => {
		const html = article('<div role="presentation"><p>Content inside a layout wrapper, with commas.</p></div>');
		expect(htmlToMarkdown(html)).toContain("Content inside a layout wrapper");
	});
});

describe("sourceless images", () => {
	it("drops an image that has no usable source", () => {
		expect(htmlToMarkdown(article('<p><img alt=""></p>'))).not.toContain("![]()");
	});

	it("keeps an image that does have one", () => {
		expect(htmlToMarkdown(article('<p><img src="/real.png" alt="R"></p>'))).toContain("![R](/real.png)");
	});
});

describe("noscript rescue edge cases", () => {
	it("keeps a real <picture> that merely precedes a noscript", () => {
		const html = article(
			'<p><picture><source srcset="/hero.webp"><img src="/hero.jpg" alt="Hero"></picture>' +
				'<noscript><img src="/fallback.jpg" alt="Fallback"></noscript></p>',
		);
		const markdown = htmlToMarkdown(html);

		expect(markdown).toContain("Hero");
	});

	it("keeps non-image content that shares the noscript", () => {
		const html = article(
			'<figure><img src="data:image/gif;base64,R0lGOD" alt="Ph">' +
				"<noscript><img src=\"/real.jpg\" alt='Real'><p>A caption worth keeping.</p></noscript></figure>",
		);
		const markdown = htmlToMarkdown(html);

		expect(markdown).toContain("A caption worth keeping.");
		expect(markdown).toContain("![Real](/real.jpg)");
	});
});

describe("large placeholder images", () => {
	it("replaces an oversized inline placeholder with the real lazy source", () => {
		const blob = `data:image/png;base64,${"A".repeat(600)}`;
		// Inside a text-bearing paragraph so the image is unambiguously part of the article body.
		const markdown = htmlToMarkdown(
			article(`<p>Figure follows, see below. <img src="${blob}" data-src="/real.png" alt="R"></p>`),
		);

		expect(markdown).toContain("![R](/real.png)");
	});

	it("does not paste an oversized inline blob into the output", () => {
		const blob = `data:image/png;base64,${"A".repeat(600)}`;
		const markdown = htmlToMarkdown(article(`<p>Figure follows, see below. <img src="${blob}" alt="R"></p>`));

		expect(markdown).not.toContain("base64");
	});
});

describe("link lists that are content", () => {
	// A pure-link list is exactly the shape navigation takes, so the filter needs explicit
	// exemptions for the two shapes authors legitimately write.
	it("keeps a link list introduced by a colon", () => {
		const html = article(
			"<p>You can read about the prior art, including:</p>" +
				'<ul><li><a href="/a">Aurora</a></li><li><a href="/b">Borg</a></li><li><a href="/m">Marathon</a></li></ul>',
		);
		const markdown = htmlToMarkdown(html);

		expect(markdown).toContain("Aurora");
		expect(markdown).toContain("Borg");
	});

	it("keeps a link list under a reference heading", () => {
		const html = article(
			'<h2>See also</h2><ul><li><a href="/fetch">Fetch API</a></li><li><a href="/cors">CORS</a></li></ul>',
		);
		const markdown = htmlToMarkdown(html);

		expect(markdown).toContain("## See also");
		expect(markdown).toContain("Fetch API");
	});

	it("still removes a plain navigation list", () => {
		const html = article(
			'<ul><li><a href="/">Home</a></li><li><a href="/about">About</a></li><li><a href="/contact">Contact</a></li></ul>',
		);
		expect(htmlToMarkdown(html)).not.toContain("About");
	});

	it("removes the short heading a removed list would leave dangling", () => {
		// Three anchors: the removal rule requires several destinations, so a two-link list —
		// which could be legitimate prose structure — is deliberately out of scope.
		const html = article(
			'<h3>Resources</h3><ul><li><a href="/1">Link one</a></li><li><a href="/2">Link two</a></li><li><a href="/3">Link three</a></li></ul>',
		);
		const markdown = htmlToMarkdown(html);

		expect(markdown).not.toContain("Link one");
		expect(markdown).not.toContain("### Resources");
	});
});

describe("document boundary climbing", () => {
	it("promotes the winner to a parent that adds substantial prose", () => {
		// The dense section outscores the container that also holds the title and lead —
		// the PostgreSQL reference-page shape.
		const dense = `<div>${"<p>Dense parameter prose, with commas, describing behaviour in detail. </p>".repeat(
			30,
		)}</div>`;
		const lead = `<h1>COMMAND</h1><p>${"Lead description of the command, also prose, also with commas. ".repeat(
			12,
		)}</p>`;
		const html = `<html lang="en"><body><div id="page"><div class="doc">${lead}${dense}</div></div></body></html>`;

		const markdown = htmlToMarkdown(html);
		expect(markdown).toContain("# COMMAND");
		expect(markdown).toContain("Lead description");
	});

	it("does not climb into link-heavy chrome", () => {
		const nav = `<div>${'<a href="/x">Navigation entry</a>'.repeat(40)}</div>`;
		const body = `<div class="doc"><p>${"Article prose, with commas, long enough to win the scoring. ".repeat(
			30,
		)}</p></div>`;
		const html = `<html lang="en"><body><div id="page">${nav}${body}</div></body></html>`;

		const markdown = htmlToMarkdown(html);
		expect(markdown).toContain("Article prose");
		expect(markdown).not.toContain("Navigation entry");
	});
});

describe("trailing boilerplate truncation", () => {
	it("cuts at a tail-positioned terminator and removes everything after it", () => {
		const html = article(
			"<h2>Related articles</h2>" +
				'<ul><li><a href="/r1">Other post one</a></li><li><a href="/r2">Other post two</a></li><li><a href="/r3">Other post three</a></li></ul>' +
				"<p>Trailing junk after the rail.</p>",
		);
		const markdown = htmlToMarkdown(html);

		expect(markdown).toContain("Sentence with, some prose.");
		expect(markdown).not.toContain("Related articles");
		expect(markdown).not.toContain("Trailing junk");
	});

	it("ignores the same wording when it appears early in the document", () => {
		// Position guard: an article *about* related-article rails must not be cut at its subject.
		const html = article(
			`<h2>Comments</h2><p>${"This section discusses comment systems at length, with commas. ".repeat(20)}</p>`,
		);
		const markdown = htmlToMarkdown(html);

		expect(markdown).toContain("comment systems");
	});

	it("removes a stranded feedback widget", () => {
		const html = article(
			"<div><p>Was this page helpful?</p><button>Yes</button><button>No</button><p>Thanks for the feedback. Ask on Stack Overflow.</p></div>",
		);
		const markdown = htmlToMarkdown(html);

		expect(markdown).not.toContain("Yes");
		expect(markdown).not.toContain("Thanks for the feedback");
	});
});

describe("literal UI words", () => {
	it("keeps inline code whose text happens to be a UI label", () => {
		const markdown = htmlToMarkdown(
			article(
				"<p>The command forwards <code>--global</code>, <code>-y</code>, <code>--copy</code> and <code>--all</code>; press <kbd>Close</kbd> or run <code>search</code>, with commas.</p>",
			),
		);

		expect(markdown).toContain("`--copy`");
		expect(markdown).toContain("`search`");
		expect(markdown).toContain("Close");
	});
});

describe("buttons", () => {
	it("drops button labels from article content", () => {
		const markdown = htmlToMarkdown(
			article("<p>Real prose sentence here, with a comma.</p><button>Click to expand</button>"),
		);

		expect(markdown).toContain("Real prose");
		expect(markdown).not.toContain("Click to expand");
	});
});

describe("unfollowable links", () => {
	it("keeps the text but drops a javascript: URL", () => {
		const markdown = htmlToMarkdown(article('<p>See <a href="javascript:void(0)">the details</a> here, truly.</p>'));

		expect(markdown).toContain("the details");
		expect(markdown).not.toContain("javascript:");
	});

	it("is not bypassed by leading whitespace in the href", () => {
		const markdown = htmlToMarkdown(article('<p>See <a href="  javascript:alert(1)">the details</a> here, truly.</p>'));

		expect(markdown).not.toContain("javascript:");
	});

	it("keeps ordinary and relative links", () => {
		const markdown = htmlToMarkdown(article('<p>See <a href="/docs/page">the docs</a> for more, please.</p>'));

		expect(markdown).toContain("[the docs](/docs/page)");
	});
});

describe("whitespace-only separator elements", () => {
	// Python's documentation writes the space in `class datetime.date` as `<span class="w"> </span>`.
	it("keeps the space a whitespace-only span represents", () => {
		const html = article(
			'<dl><dt><em>class </em><span class="w"> </span><code>datetime.date</code></dt><dd>A date object, plainly.</dd></dl>',
		);
		const markdown = htmlToMarkdown(html);

		expect(markdown).toContain("*class*");
		expect(markdown).not.toContain("*class*datetime");
	});

	it("still removes genuinely empty wrappers", () => {
		const markdown = htmlToMarkdown(
			article("<p>Before text, here.</p><span></span><div></div><p>After text, here.</p>"),
		);
		expect(markdown).not.toMatch(/\n{4,}/);
	});
});

describe("title deduplication", () => {
	it("does not prepend a second title when the body's h1 follows a breadcrumb", () => {
		const html = `<html lang="en"><head><meta property="og:title" content="Quick Start – React"></head><body><article><a href="/learn">Learn React</a><h1>Quick Start</h1>${filler()}</article></body></html>`;
		const markdown = htmlToMarkdown(html);

		expect(markdown.match(/^# /gm)?.length ?? 0).toBe(1);
	});
});

describe("screen-reader-only text", () => {
	it("drops accessibility labels in every class naming convention", () => {
		const html = article(
			'<span class="VisuallyHidden-styles__VisuallyHiddenStyled-sc-1y1x">Site search</span><span class="srOnly">Opens in a new tab</span><span class="screen-reader-text">Skip ahead</span>',
		);
		const markdown = htmlToMarkdown(html);

		expect(markdown).not.toContain("Site search");
		expect(markdown).not.toContain("Opens in a new tab");
		expect(markdown).not.toContain("Skip ahead");
	});

	it("keeps elements whose class merely contains the words", () => {
		const markdown = htmlToMarkdown(article('<p class="not-sr-only">Visible on every screen, here.</p>'));
		expect(markdown).toContain("Visible on every screen, here.");
	});
});

describe("consent placeholders", () => {
	const placeholder =
		"This content isn't visible due to your cookie preferences. To load this content, click the Allow button below.";

	it("removes the stand-in a consent manager leaves where an embed was", () => {
		const markdown = htmlToMarkdown(article(`<div class="x7f2"><p>${placeholder}</p><button>Allow</button></div>`));
		expect(markdown).not.toContain("cookie preferences");
	});

	it("keeps prose that discusses the same subject", () => {
		const prose = `<p>Regulators found that this content isn't visible due to your cookie preferences on many sites.</p>`;
		expect(htmlToMarkdown(article(prose))).toContain("Regulators found");
	});
});

describe("furniture removal when a wrapper matches a furniture class", () => {
	// Amazon names every block `*_feature_div celwidget`. The class match condemns the wrapper that
	// holds the product description, which used to abandon furniture removal altogether.
	const rail = (name: string) =>
		`<div class="${name}_feature_div celwidget">${Array.from(
			{ length: 30 },
			(_, i) => `<a href="/p/${name}${i}">Product ${name} ${i}</a>`,
		).join(" ")}</div>`;

	const html = `<html lang="en"><body><div class="page celwidget">
		${rail("sims")}
		<div class="desc_feature_div celwidget">${filler()}</div>
		${rail("sponsored")}
	</div></body></html>`;

	it("keeps the prose and drops the link-dense rails", () => {
		const markdown = htmlToMarkdown(html);

		expect(markdown).toContain("Sentence with, some prose.");
		expect(markdown).not.toContain("Product sims");
		expect(markdown).not.toContain("Product sponsored");
	});
});
