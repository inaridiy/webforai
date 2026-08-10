---
"webforai": major
---

Rewrite content extraction, add site adapters, and repair long-standing markup handling bugs.

### Extraction

The main-content extractor is rebuilt around Readability-style candidate scoring — paragraph
density, comma counts, class/id weighting, ancestor propagation and sibling merging — layered
with three signals the classic algorithm predates: semantic markup (`<article>`, `<main>`,
`role="main"`, schema.org `articleBody`), rendered geometry from `data-rwidth`/`data-rheight`
when a loader supplies it, and CJK-aware length thresholds. Every narrowing step is guarded, so
a heuristic that cuts too deep falls back to the wider tree rather than losing the article.

Measured over a 60-page corpus of real sites, the share of output lines that are bare links —
the clearest sign that navigation leaked into the result — fell from 10.6% to 5.2%.

That heuristic alone overstated the improvement. A blinded A/B evaluation, in which a language
model scored both versions of each page without being told which was which, initially came out
close to even: 20 wins, 19 losses, 7 ties. The losses identified several real regressions, all
fixed below, after which nine of the seventeen contested pages flipped to a win. Absolute scores
drift by ±10-25 between judging runs, so the win/loss direction is the trustworthy signal.

### Site adapters

Pages that generic scoring cannot read are now handled by dedicated adapters, selected by
hostname or by a platform fingerprint so that self-hosted instances are covered too:

GitHub, Stack Overflow, npm, MDN, Zenn, Qiita, Medium, Substack, note, Hatena, WordPress,
Wikipedia, Reddit, YouTube, Hacker News, Docusaurus, VitePress, MkDocs, Read the Docs, GitBook.

YouTube reads the embedded player JSON, since a watch page has no readable DOM at all; Hacker
News reconstructs the reply tree from its table layout as nested blockquotes. Adapters that
produce too little are ignored in favour of generic extraction, so a site redesign degrades
rather than breaks.

### Site adapters are held to evidence

The MDN adapter was removed. Blinded evaluation scored it consistently *worse* than generic
extraction — same length, same heading and code-block counts, but nine times the navigation
noise — so it added nothing but risk. An adapter has to earn its place.

### Techniques taken from established extractors

Surveying @mozilla/readability, trafilatura, defuddle, postlight/parser, turndown and markitdown
turned up several things a plain Readability port lacks. Adopted so far:

- **Boilerplate detection by visible text**, defuddle's answer to hashed class names. An element
  whose *entire* text is a known interface label — "Copy page", "Was this page helpful? Yes No",
  "Edit this page", "目次", "続きを読む" — is furniture no matter what it is called. Whole-text
  matching under a length cap means prose that merely mentions "share" is untouched.
- **`<noscript>` image rescue**, from Readability's `_unwrapNoscriptImages`.
- **URL scheme allowlist on links**, from markitdown. `javascript:`, `data:` and `blob:` hrefs
  keep their text and lose the URL, since none of them mean anything once the page is gone.
- **`alt` falling back to `title`** on images, and **oversized `data:` sources dropped** rather
  than pasted into the output as multi-kilobyte base64.
- **`colspan`/`rowspan` clamped** before grid expansion. The conversion materialises one cell per
  spanned row and column, so a malformed `colspan="999999"` would otherwise expand a small table
  into hundreds of millions of cells.

Readability's whole-pipeline flag-relaxation retry and trafilatura's multi-algorithm cascade
were evaluated and deliberately *not* ported: per-step guards plus the boundary climb below cover
the same failure modes on this corpus without a retry loop's cost.

### Document boundaries and page tails

- **Boundary climbing.** Score propagation concentrates in the densest section of a long
  document, so on reference pages the winner was one *section* — PostgreSQL's SELECT page scored
  its Parameters section above the container holding the title, synopsis and description, and
  the output opened mid-document. The winner is now promoted to an ancestor while the ancestor
  adds substantial low-link text and scored within a factor of the winner, mirroring
  Readability's parent-climb.
- **Terminating blocks** (boilerpipe's technique). Feedback widgets, last-modified lines and
  related-article rails end well-formed prose, so no per-element rule can condemn them. The
  first such marker in the document's tail now truncates everything after it, position-guarded
  to the final 20% so an article *about* comments is never cut at its own subject.
- **Link-only blocks** are recognised in `div`/`p` form as well as list markup — header rows
  ("Docs Blog Showcase…") are routinely plain divs of anchors — with two content exemptions:
  a list introduced by a colon ("…including:") and a list under a reference heading ("See
  also", "参考文献") are kept, and a removed list takes its dangling short heading with it.
- **Buttons are dropped** from generic extraction: a button renders as its label, and the label
  is always an instruction to a browser.

### Bug fixes### Bug fixes

- **Lazily-loaded images produced `![alt]()`.** `data-src`, `data-original`, `srcset` and friends
  are now resolved to a real URL. `srcset` was doubly broken: HAST stores it under `srcSet` and
  as an array, so the value was never read.
- **KaTeX and MathJax output was duplicated** (`$E$E`), because both render the formula twice —
  once as MathML, once as styled HTML.
- **`aria-hidden`, `aria-modal` and `xml:lang` filters never fired.** HAST stores attributes
  under their DOM property names, so the hyphenated lookups always returned `undefined`.
- **Superscripts and subscripts were flattened**, turning `x²` into `x2` and merging citation
  markers into the sentence. They are now preserved as inline HTML.
- **`role="heading"` elements were dropped to plain paragraphs.** They are promoted to real
  headings using `aria-level`.
- **Definition lists rendered as anonymous bullets**, losing the term/definition pairing.
- `pipeExtractors` discarded the `url` it was given, so extractors never received it.
- **Whitespace inside code blocks was destroyed.** Syntax highlighters emit inter-token spacing
  as whitespace-only `<span>`s; the empty-wrapper cleanup measured those as zero-length and
  deleted them, turning `let obj: any` into `letobj: any` and collapsing YAML samples onto one
  line. Preformatted regions are now exempt from that pass.
- **Formulae could be deleted as empty wrappers**, since `<math>` carries no text of its own.
- **MediaWiki maths rendered twice**, once as MathML and once as a fallback image whose alt text
  repeats the formula.
- **Wikipedia navigation sidebars survived**: the removal list covered `.navbox` but not the
  `.sidebar` and `.side-box` tables that open many articles.
- **The page title was frequently missing.** Article containers routinely exclude the `<h1>`, so
  conversions opened mid-article. The title is now prepended when, and only when, the content
  does not already begin with a top-level heading.
- **Images that only existed inside `<noscript>` were discarded.** The standard lazy-loading
  fallback is a placeholder `<img>` followed by a `<noscript>` holding the real one; removing
  `<noscript>` as non-content kept the placeholder and threw the real image away. The noscript
  content is now hoisted into its place and the placeholder dropped.
- **`role="presentation"` deleted real content.** The role marks decorative *structure* — a
  layout table, a wrapper — while the content inside is usually the article.
- **Images with no usable source emitted `![]()`.** Tracking pixels and spacers are now dropped
  instead, once normalisation has exhausted every lazy-loading attribute.
- **The extractor's final guard never fired.** The cleanup pass prunes in place and returns the
  same tree, so the fallback returned exactly the tree it had just rejected. The pass is now
  priced before it runs, which also removes a clone from the hot path.
- **Site adapters mutated a caller-supplied HAST tree**, because ownership was never propagated
  to them.
- **`data-srcset` was never read**, since HAST stores it as `dataSrcset` and the lookup used the
  raw attribute name. Base64 placeholders in formats other than GIF/SVG were also not recognised.
- **Formulae lost symbols.** MathML carries the author's original LaTeX in its `alttext`
  annotation; converting the rendered MathML back to LaTeX instead is lossy, and the losses are
  silent and content-altering — Euler's identity came out as `e^{i } + 1 = 0`, with π gone, and
  `i^2 = -1` lost its minus sign. The annotation is now preferred.
- **Accessibility-hidden MathML was removed as invisible.** Renderers show a formula as an image
  and keep the MathML hidden beside it; with the duplicate image also removed, the formula had no
  representation left at all.
- **Adapter output was never sanitised.** Adapters select a container but do not clean it, so
  comments and metadata elements survived — MediaWiki's parser-cache comment block appeared
  verbatim at the end of every Wikipedia conversion.
- **Whitespace-only separator elements were deleted as empty wrappers.** Python's documentation
  writes the space in `class datetime.date` as `<span class="w"> </span>`; removal glued every
  API signature together. Such elements are now replaced with a space instead of removed.
- **Emphasis with a trailing space produced invalid Markdown** in definition terms
  (`*class *name`, which is not emphasis at all); boundary whitespace is hoisted outside the
  delimiters.
- **The added page title could duplicate a heading** that sat after a breadcrumb line rather
  than at the very start of the output.
- **The URL scheme allowlist could be bypassed by leading whitespace** in an href, which
  browsers strip before resolving.
- **JSON-LD `headline` was trusted over `og:title`.** Wikipedia and others put a descriptive
  sentence there, which then read as the page title; sentence-length values are now rejected.

### New API

- `htmlToMarkdownWithMetadata()` returns the Markdown alongside the page's metadata.
- `frontmatter: true` prepends a YAML block built from JSON-LD, Open Graph and meta tags.
- `extractMetadata()`, `toFrontmatter()`, `normalizeHast()` are exported directly.
- `autoExtractor` / `createAutoExtractor({ adapters })` is the new default; pass `adapters: false`
  to disable site-specific handling.
- `ExtractParams` gains `owned`, which lets an extractor mutate the tree instead of cloning it.

### Performance

Extraction is roughly **1.9x faster**: the previous implementation deep-cloned the whole document
on each of four `unist-util-filter` passes and re-walked it for every length measurement, where
the new engine prunes in place in a single pass and memoises its metrics.

End-to-end conversion is close to unchanged (about 1.03x), because HTML parsing and the
HAST-to-MDAST conversion together account for roughly two thirds of the work and neither is
affected by this change.

### Breaking changes

- `takumiExtractor` and `minimalFilter` return trees produced by the new engine. Output differs
  on essentially every page — generally by keeping less boilerplate and more article text.
- The default extractor is now `autoExtractor`, which may dispatch to a site adapter. Pass
  `extractors: [takumiExtractor]` for generic extraction only.
- Extractors may mutate their input when `owned` is set. The library only sets it for trees it
  parsed itself, so callers passing their own HAST are unaffected unless they opt in.
