# webforai

## 4.3.0

### Minor Changes

- [#77](https://github.com/inaridiy/webforai/pull/77) [`2d7ec9c`](https://github.com/inaridiy/webforai/commit/2d7ec9c54c929c5f98e55f2ce0b60925696bec9a) Thanks [@inaridiy](https://github.com/inaridiy)! - `stripScriptBodies(html)`: empties the script and style bodies conversion never reads, so HTML can be
  made smaller before it crosses a process boundary or a size cap; the converted Markdown is unchanged.

  - JSON-LD, YouTube's player response and bot-challenge scripts are kept whole.
  - Fix: attribute values containing `>` (MediaWiki's `data-mw`) no longer cut the tag short. Pages
    over 2M characters, where the library already strips scripts to bound memory, could lose content
    around such a `<style>` (a Wikipedia list item, for example).
  - Linear on hostile input: thousands of unclosed tags or quotes took tens of seconds before; a
    `<script>` inside an HTML comment is left alone.

### Patch Changes

- [#78](https://github.com/inaridiy/webforai/pull/78) [`250f653`](https://github.com/inaridiy/webforai/commit/250f65382d595217776f55f6f4ce94acbd6af1fd) Thanks [@inaridiy](https://github.com/inaridiy)! - Cleaner code fences and headings on documentation pages.

  - **Code block languages**: SyntaxHighlighter's `brush: js` class (MDN) and Sandpack's `sp-javascript`
    class (react.dev) are read as the block's language. Guessing from the code itself only adopts a
    decisive signal (a shebang, `import … from`, a Dockerfile `FROM`); otherwise the fence has no info
    string instead of a weak guess (JSX labelled `html`, JavaScript labelled `bash`) or `plain`.
  - **Language labels**: a language name printed beside a code block (MDN's `js` header) becomes the
    fence's language instead of a stray paragraph above it (`normalize.codeLabels`, default on).
  - **Heading permalinks**: a heading wrapped in its own in-page anchor (`## [Title](#title)`, docsify's
    `#/page?id=…`) is written as plain `## Title`. Links to other pages, and in-page links covering only
    part of the heading, are kept (`normalize.headingAnchors`, default on).
  - **Extraction**: a "Powered by …" credit in the tail of the page ends the main content, like the
    existing feedback-widget and last-updated terminators.

## 4.2.0

### Minor Changes

- [#74](https://github.com/inaridiy/webforai/pull/74) [`a241df4`](https://github.com/inaridiy/webforai/commit/a241df497e76b86f0ae120370211c354d0efb5ca) Thanks [@inaridiy](https://github.com/inaridiy)! - `agentExtractor`: main content for AI agents, plus the links they may follow.

  - Keeps exactly the main content of the default extractor, then appends reader comments
    (`## Comments`) and the page's other links under `## Links`, grouped as Related, Pagination,
    Section navigation, Breadcrumb and Site navigation. Share buttons, ads, sign-up and legal links are
    left out; each link is listed once, under its most specific role.
  - Roles come from small per-role models (about 100 KB, loaded only when `agentExtractor` or
    `createAgentExtractor` is imported); `createAgentExtractor({ roles, comments, roleModels })`
    chooses the groups, and `roleModels: null` falls back to class/aria hints.
  - `readabilityExtractor` names the default main-content extractor (same as `autoExtractor`).
  - CLI: `--extractor agent` and `--extractor readability` (local conversion).
  - `createKiwameExtractor` accepts `onScored`, called with the scored blocks before pruning.

- [#71](https://github.com/inaridiy/webforai/pull/71) [`a1da0c5`](https://github.com/inaridiy/webforai/commit/a1da0c57c1cb1b649c9789dbae0f22df41c49db0) Thanks [@inaridiy](https://github.com/inaridiy)! - Cleaner Markdown structure, an extraction report with a page confidence, and a parsing crash fix.

  - **Extraction report**: `htmlToMarkdownWithMetadata` returns `extraction: { extractor, confidence }`
    (also via `htmlToMdast(html, { onExtraction })`). `extractor` is `kiwame`, `takumi` (its fallback)
    or `adapter`; for kiwame, `confidence` (0–1) estimates how well the extracted content matches the
    page's main content (about the expected token F1), from a ~2.5 KB model over page statistics. Use
    it to flag pages that probably went wrong.
  - **Line breaks**: a paragraph is split where the page leaves a blank line with `<br><br>`, and
    breaks at the start or end of a paragraph or heading no longer leave stray backslashes.
  - **Tables**: a table without `<th>` whose first row is entirely bold uses it as the header instead
    of an empty header row; columns empty in every row are dropped; a heading alone in its row (a
    section caption in a pricing table) no longer turns a data table into flattened paragraphs.
  - **Inline text**: whitespace at the edges of bold/italic/strikethrough moves outside the markers
    (`**WIN55 **` did not render as bold); Material Icons/Symbols ligature names (`query_builder`) are
    dropped; adjacent `span`/`time`/`label` elements laid out side by side get a space where the
    script changes (`2026-04-10点击次数` → `2026-04-10 点击次数`).
  - **Parsing**: requires `hast-util-from-parse5` ^8.0.3, whose hastscript 9 no longer turns elements
    such as `<button type="text">` or `<li type="a" value="3">` into a malformed node that made
    `htmlToMarkdown` throw.

  WCEB token F1 is unchanged (0.892); these changes are about structure and robustness.

- [#76](https://github.com/inaridiy/webforai/pull/76) [`d3ccd10`](https://github.com/inaridiy/webforai/commit/d3ccd1090bb207177fb09828d04e4d72c7bff7fa) Thanks [@inaridiy](https://github.com/inaridiy)! - One list of extractor presets for the library, the CLI and the hosted platform.

  - `EXTRACTOR_PRESETS` (`auto`, `readability`, `agent`, `kiwame`, `takumi`, `minimal`, `none`) and
    `presetExtractors(name)`, which returns the `extractors` option for a preset name.
  - The root export now includes the types the extractor options mention: `ScoredPage` (for
    `onScored`), `RoleModels` (for `roleModels`), and `LINK_ROLE_TITLES`.
  - CLI: every `--extractor` preset works with `--loader platform` and the `crawl`/`batch` jobs
    (`agent`, `kiwame` and `readability` were local-only or rejected); `--json` includes
    `extraction` (which extractor ran and kiwame's confidence).
  - `webforai/platform`: `ExtractorPreset` covers every preset, scrape results carry
    `extraction`, and the types of the internal `PlatformRpc` Service Binding entrypoint are
    exported (`PlatformRpc`, `RpcConvertOptions`, `RpcConvertResult`, `RpcConvertOutcome`,
    `RpcConvertError`, warning and error codes).

- [#74](https://github.com/inaridiy/webforai/pull/74) [`a241df4`](https://github.com/inaridiy/webforai/commit/a241df497e76b86f0ae120370211c354d0efb5ca) Thanks [@inaridiy](https://github.com/inaridiy)! - kiwame, the default extractor for pages without a site adapter, selects main content more
  accurately.

  - **Sequence model**: a small bidirectional GRU reads the page's blocks in order — their features,
    hashed words and character pairs, and the tag and class names around them — and its estimate is
    averaged with the gradient-boosted trees'. Weights are int8 (about 100 KB); it adds a few
    milliseconds on a typical page.
  - **Page title**: blocks are scored by where they sit relative to the block that repeats the page's
    title (`og:title` or `<title>`), so a product page's own details are told apart from the other
    products listed beside them, and an article from its related-posts rail.
  - **Within-page scores**: the second stage sees where each block's score sits within its page
    (rank, ratio to the page's best block), not only its absolute value.
  - **Clean-up**: a link-only block the models chose to keep (a grid of product cards, a list of
    results) is no longer removed by the final clean-up; a tail-positioned "Related articles" rail or
    feedback widget still ends the content.
  - The models were retrained; the default threshold is now 0.5 and the confidence model was
    refitted.
  - `createKiwameExtractor` accepts `neuralModel` (`null` turns the sequence model off),
    `neuralWeight`, `cleanupSpare`, and evaluation hooks `probabilities` and `postRules`.

  WCEB token F1 is 0.892 per page (unchanged) and 0.909 over its eight datasets (was 0.903).

### Patch Changes

- [#73](https://github.com/inaridiy/webforai/pull/73) [`1e537bb`](https://github.com/inaridiy/webforai/commit/1e537bb83fe4147eaf7627cfeed3007ac4ed98cb) Thanks [@inaridiy](https://github.com/inaridiy)! - All browser loaders annotate rendered geometry. The Puppeteer and Cloudflare Puppeteer loaders now
  run the same `data-rwidth`/`data-rheight` annotation as the Playwright loader before reading the
  page, so extraction drops elements the browser laid out to nothing (menus and sections hidden with
  CSS classes) whichever loader fetched the page. The annotation is exported as `annotateGeometry`
  from `webforai/loaders/geometry` for pages rendered with your own browser code
  (`await page.evaluate(annotateGeometry)` before `page.content()`).

- [#71](https://github.com/inaridiy/webforai/pull/71) [`a1da0c5`](https://github.com/inaridiy/webforai/commit/a1da0c57c1cb1b649c9789dbae0f22df41c49db0) Thanks [@inaridiy](https://github.com/inaridiy)! - feat: cleaner Markdown structure, extraction confidence, parsing crash fix

## 4.1.1

### Patch Changes

- [#69](https://github.com/inaridiy/webforai/pull/69) [`dd9d233`](https://github.com/inaridiy/webforai/commit/dd9d233bd18b20827795c993fc7c0725d7de29e6) Thanks [@inaridiy](https://github.com/inaridiy)! - README: focus the npm page on the package (entry-point table, no self-hosting section) and clarify the site-adapter comment in the quick start.

## 4.1.0

### Minor Changes

- [#66](https://github.com/inaridiy/webforai/pull/66) [`6d3d99e`](https://github.com/inaridiy/webforai/commit/6d3d99e1afb7e0053d6dc6f1afb7dd33f1ea701d) Thanks [@inaridiy](https://github.com/inaridiy)! - Conversion accuracy pass. Output changes on many pages; no API changes.

  - **Code**: inactive code tabs (npm/yarn/pnpm, `example.ts`/`client.ts`) are kept and labelled as
    fence meta (`title="pnpm"`), including VitePress radio tabs. Furniture and UI-phrase rules no
    longer reach inside `<pre>`/`<code>` (Python's `print` and Go comments were being deleted).
    No blank line after every CodeMirror/Sandpack line, Twoslash hover cards no longer split tokens
    onto separate lines, and shiki-twoslash blocks get their language, drop the "Try" link and show
    errors as `// error TS2345: …`.
  - **Tables**: cells holding paragraphs, lists or code are flattened with `<br>`, so rows no longer
    break or leak `&#xA;`; tables of multi-line code samples are laid out as labelled blocks.
  - **Extraction**: when the furniture pass would cut too deep, link-dense rails are still removed
    instead of skipping the pass (Amazon carousels, Reddit sidebars); screen-reader-only text in any
    class spelling and consent-manager embed placeholders are removed; `not-sr-only` is no longer
    treated as furniture.
  - **Other**: display math inside a sentence becomes its own block; the prepended title drops the
    site name (`Markdown - Wikipedia` → `Markdown`); long `<title>`s are accepted; undescribed
    lazy-loading placeholder images are dropped.

- [#67](https://github.com/inaridiy/webforai/pull/67) [`562ecc7`](https://github.com/inaridiy/webforai/commit/562ecc786c50fea5bdf58bb179e5787b52d9f38b) Thanks [@inaridiy](https://github.com/inaridiy)! - kiwame, a learned main-content extractor, and Worker-safe parsing.

  - **New default for pages without a site adapter**: `kiwameExtractor`, a two-stage gradient-boosted
    tree classifier over text blocks (~100 KB of generated TypeScript, no WASM or new dependencies).
    Token F1 on the WCEB benchmark 0.874 → 0.892. `takumiExtractor` stays available, `createAutoExtractor({ fallback })`
    selects the extractor behind the site adapters, and the CLI gains `--extractor kiwame`
    (local conversion only; `takumi` keeps the heuristic).
  - **Parsing for Workers**: HTML is parsed without source positions (about half the tree memory)
    and with element nesting capped at 256 levels; 2,000 nested elements used to throw
    `RangeError`. Documents over 2 M characters have script and style bodies emptied before
    parsing (JSON-LD kept).
  - New exports: `kiwameExtractor`, `createKiwameExtractor`, `KiwameExtractorOptions`.

## 4.0.0

### Major Changes

- [#62](https://github.com/inaridiy/webforai/pull/62) [`f8c3e54`](https://github.com/inaridiy/webforai/commit/f8c3e5434041e1a65e613501f9f21049e7257cda) Thanks [@inaridiy](https://github.com/inaridiy)! - Rebuild the CLI for automation-first use.

  - **Non-interactive by default**: `npx webforai <url>` converts and prints Markdown to
    stdout (logs go to stderr); `-o <path>` writes a file. The guided wizard now lives behind
    `-i`/`--interactive`.
  - **`--json`** emits a machine-readable envelope (`source`, `loader`, `url`, `markdown`,
    `metadata`, plus platform fields).
  - **Platform loader**: `-l platform` (or just `--engine`/`--region`) converts via the hosted
    webforai platform using the new `webforai/platform` client; API key from `--api-key` or
    `WEBFORAI_API_KEY`, self-hosted deployments via `--platform-url`/`WEBFORAI_PLATFORM_URL`.
  - **Agent Skills**: `webforai skill` prints an Agent Skill for this CLI; `webforai skill
--install` installs it through Vercel's `skills` CLI (`npx skills add`), and
    `npx skills add inaridiy/webforai` works straight from the repository.
  - New conversion flags: `--extractor auto|takumi|minimal|none`, `--frontmatter`,
    `--screenshot` (platform browser engines).
  - `-h` documents every flag with examples, env vars and exit codes (0 ok / 1 runtime /
    2 usage).
  - Dropped the unused `zx` dependency.

### Minor Changes

- [#62](https://github.com/inaridiy/webforai/pull/62) [`f8c3e54`](https://github.com/inaridiy/webforai/commit/f8c3e5434041e1a65e613501f9f21049e7257cda) Thanks [@inaridiy](https://github.com/inaridiy)! - CLI: `webforai crawl <url> -o <dir>` and `webforai batch [urls…|-f file] -o <dir>` run platform
  jobs and write one Markdown file per page (`--llms-txt` also writes `llms.txt` and
  `llms-full.txt`; `--sitemap skip|include|only` seeds a crawl from the site's sitemaps).
  `webforai/platform` exposes the crawl `sitemap` option, and 401/402 errors name the dashboard
  where a key or a plan is managed.

- [#62](https://github.com/inaridiy/webforai/pull/62) [`f8c3e54`](https://github.com/inaridiy/webforai/commit/f8c3e5434041e1a65e613501f9f21049e7257cda) Thanks [@inaridiy](https://github.com/inaridiy)! - New `webforai/platform` subpath: a typed, dependency-free client for the hosted
  webforai platform API. Covers `scrape` (sync and async), `batch`, `crawl`, job
  status/results with cursor paging, `waitForJob` polling, a `jobResults` async iterator
  that transparently downloads spilled results, and the keyless `demoScrape`. Errors
  surface as `PlatformApiError` with the API's `code`/`status`/`retryAfter`. All I/O goes
  through an injectable, structurally-typed `fetch` (`FetchLike`) so the client runs
  unchanged behind Cloudflare Workers service bindings, undici/node-fetch, or test stubs.

- [#62](https://github.com/inaridiy/webforai/pull/62) [`f8c3e54`](https://github.com/inaridiy/webforai/commit/f8c3e5434041e1a65e613501f9f21049e7257cda) Thanks [@inaridiy](https://github.com/inaridiy)! - `webforai/platform` and the CLI: new opt-in `respectRobotsTxt` request option (scrape, batch,
  crawl) and `--respect-robots` CLI flag (platform loader only). When set, the platform honors the
  target site's robots.txt rules for the `webforai-platform` user-agent token; a disallowed URL
  fails with `robots_disallowed` and is not billed. Off by default, so existing requests behave
  as before.

- [#62](https://github.com/inaridiy/webforai/pull/62) [`f8c3e54`](https://github.com/inaridiy/webforai/commit/f8c3e5434041e1a65e613501f9f21049e7257cda) Thanks [@inaridiy](https://github.com/inaridiy)! - `webforai/platform` and the CLI: `region` is now `auto` | `jp` — the hosted platform only has
  dedicated Japanese egress IPs. `us`, `eu`, `uk` and `asia` were never honoured reliably and are
  rejected by the API (`400 invalid_request`) and by `--region` (usage error `2`).

### Patch Changes

- [#62](https://github.com/inaridiy/webforai/pull/62) [`f8c3e54`](https://github.com/inaridiy/webforai/commit/f8c3e5434041e1a65e613501f9f21049e7257cda) Thanks [@inaridiy](https://github.com/inaridiy)! - CLI: the interactive engine picker and the Agent Skill quote the platform's 2026-09-24 credit
  schedule (browser 2, proxy-browser 3).

- [#62](https://github.com/inaridiy/webforai/pull/62) [`f8c3e54`](https://github.com/inaridiy/webforai/commit/f8c3e5434041e1a65e613501f9f21049e7257cda) Thanks [@inaridiy](https://github.com/inaridiy)! - CLI: `--help` lists the CLI docs, the platform docs and the platform dashboard, and
  `invalid_api_key` / `payment_required` errors print a `hint:` line with the dashboard URL
  of the configured platform.

- [#62](https://github.com/inaridiy/webforai/pull/62) [`f8c3e54`](https://github.com/inaridiy/webforai/commit/f8c3e5434041e1a65e613501f9f21049e7257cda) Thanks [@inaridiy](https://github.com/inaridiy)! - Code blocks take their language from `data-language` / `data-lang` (Shiki via
  rehype-pretty-code, as on shadcn-style docs) instead of falling back to detection or `plain`.

- [#62](https://github.com/inaridiy/webforai/pull/62) [`f8c3e54`](https://github.com/inaridiy/webforai/commit/f8c3e5434041e1a65e613501f9f21049e7257cda) Thanks [@inaridiy](https://github.com/inaridiy)! - `webforai/platform`: document that the platform's crawl now honors robots.txt by default
  (`respectRobotsTxt` defaults to `true` for `crawl`, `false` for `scrape` and `batch`).

- [#62](https://github.com/inaridiy/webforai/pull/62) [`f8c3e54`](https://github.com/inaridiy/webforai/commit/f8c3e5434041e1a65e613501f9f21049e7257cda) Thanks [@inaridiy](https://github.com/inaridiy)! - `webforai/platform`: `DemoResult` gains an optional `engine` — the concrete engine the
  demo's `auto` resolved to (absent from platform deployments older than 2026-09-24).

- [#62](https://github.com/inaridiy/webforai/pull/62) [`f8c3e54`](https://github.com/inaridiy/webforai/commit/f8c3e5434041e1a65e613501f9f21049e7257cda) Thanks [@inaridiy](https://github.com/inaridiy)! - Extraction no longer drops inline `code`/`kbd`/`samp`/`var` text that looks like a UI label
  (e.g. `<code>--copy</code>`), and a `<dl>` whose rows are wrapped in `<div>`s converts to a
  definition list instead of nothing.

## 3.0.0

### Major Changes

- [`8cc92da`](https://github.com/inaridiy/webforai/commit/8cc92da59724527703054eb8e5e51a3b79e2539b) Thanks [@inaridiy](https://github.com/inaridiy)! - Rewrite content extraction, add site adapters, and repair long-standing markup handling bugs.

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

  The MDN adapter was removed. Blinded evaluation scored it consistently _worse_ than generic
  extraction — same length, same heading and code-block counts, but nine times the navigation
  noise — so it added nothing but risk. An adapter has to earn its place.

  ### Techniques taken from established extractors

  Surveying @mozilla/readability, trafilatura, defuddle, postlight/parser, turndown and markitdown
  turned up several things a plain Readability port lacks. Adopted so far:

  - **Boilerplate detection by visible text**, defuddle's answer to hashed class names. An element
    whose _entire_ text is a known interface label — "Copy page", "Was this page helpful? Yes No",
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
  were evaluated and deliberately _not_ ported: per-step guards plus the boundary climb below cover
  the same failure modes on this corpus without a retry loop's cost.

  ### Document boundaries and page tails

  - **Boundary climbing.** Score propagation concentrates in the densest section of a long
    document, so on reference pages the winner was one _section_ — PostgreSQL's SELECT page scored
    its Parameters section above the container holding the title, synopsis and description, and
    the output opened mid-document. The winner is now promoted to an ancestor while the ancestor
    adds substantial low-link text and scored within a factor of the winner, mirroring
    Readability's parent-climb.
  - **Terminating blocks** (boilerpipe's technique). Feedback widgets, last-modified lines and
    related-article rails end well-formed prose, so no per-element rule can condemn them. The
    first such marker in the document's tail now truncates everything after it, position-guarded
    to the final 20% so an article _about_ comments is never cut at its own subject.
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
  - **`role="presentation"` deleted real content.** The role marks decorative _structure_ — a
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

## 2.1.1

### Patch Changes

- [#58](https://github.com/inaridiy/webforai/pull/58) [`7fa6ec7`](https://github.com/inaridiy/webforai/commit/7fa6ec75b9966a92820a21a4b8f9eb85c5c2020c) Thanks [@inaridiy](https://github.com/inaridiy)! - fix

## 2.1.0

### Minor Changes

- [#56](https://github.com/inaridiy/webforai/pull/56) [`ea8b326`](https://github.com/inaridiy/webforai/commit/ea8b3261eb2a7ec5b635a54a17ed18cca50106f4) Thanks [@inaridiy](https://github.com/inaridiy)! - Add minimal filter extractor

## 2.0.1

### Patch Changes

- [#52](https://github.com/inaridiy/webforai/pull/52) [`a2e0fc0`](https://github.com/inaridiy/webforai/commit/a2e0fc0b00554a3d860f0cdf67494c1691f9eeb3) Thanks [@moons-14](https://github.com/moons-14)! - update package.json homepage

## 2.0.0

### Major Changes

- [#50](https://github.com/inaridiy/webforai/pull/50) [`ff85d73`](https://github.com/inaridiy/webforai/commit/ff85d73a6d64a52a990b031f50430fe2956c5f2f) Thanks [@inaridiy](https://github.com/inaridiy)! - New Documentation Site

- [#49](https://github.com/inaridiy/webforai/pull/49) [`baaf7ea`](https://github.com/inaridiy/webforai/commit/baaf7ea33b9a75d07dfb910231d64d5b6efc6f40) Thanks [@inaridiy](https://github.com/inaridiy)! - “Readability” Extractor renamed takumi and license changed to Apache2 license.

## 1.6.3

### Patch Changes

- [#47](https://github.com/inaridiy/webforai/pull/47) [`fc84541`](https://github.com/inaridiy/webforai/commit/fc84541331ebc2dbf7d80af0694d9cdc79145a59) Thanks [@inaridiy](https://github.com/inaridiy)! - Fix Playwright installation command for improved reliability

## 1.6.2

### Patch Changes

- [#45](https://github.com/inaridiy/webforai/pull/45) [`00d2a55`](https://github.com/inaridiy/webforai/commit/00d2a55b4a25f6d84da37cb89ec629b5f6179357) Thanks [@inaridiy](https://github.com/inaridiy)! - Re Re Fix CLI

- [#45](https://github.com/inaridiy/webforai/pull/45) [`a7db6ef`](https://github.com/inaridiy/webforai/commit/a7db6ef61f1321e010ed16022086a684c19d77a5) Thanks [@inaridiy](https://github.com/inaridiy)! - Re Re Fix CLI

## 1.6.1

### Patch Changes

- [#41](https://github.com/inaridiy/webforai/pull/41) [`5e82341`](https://github.com/inaridiy/webforai/commit/5e82341c2a3b8275d78ce808c7d4f81dacb1acdd) Thanks [@inaridiy](https://github.com/inaridiy)! - Fix with { type : "json" } Error

## 1.6.0

### Minor Changes

- [#40](https://github.com/inaridiy/webforai/pull/40) [`30d181e`](https://github.com/inaridiy/webforai/commit/30d181e7a29452b37f6dd665de3e7a3b743c1244) Thanks [@inaridiy](https://github.com/inaridiy)! - The CLI has been completely corrected. Maybe.

### Patch Changes

- [#38](https://github.com/inaridiy/webforai/pull/38) [`78f2c44`](https://github.com/inaridiy/webforai/commit/78f2c445f88136bdc596e57b91bec1b223f782d9) Thanks [@inaridiy](https://github.com/inaridiy)! - improve seido

## 1.5.1

### Patch Changes

- [#37](https://github.com/inaridiy/webforai/pull/37) [`39c1122`](https://github.com/inaridiy/webforai/commit/39c112205d0aa2a07a46c92b94be6ed91239cf0f) Thanks [@inaridiy](https://github.com/inaridiy)! - Fix CLI Dep Error

## 1.5.0

### Minor Changes

- [#30](https://github.com/inaridiy/webforai/pull/30) [`167acb1`](https://github.com/inaridiy/webforai/commit/167acb1dca303d651d997c23224d3366ff4375ac) Thanks [@moons-14](https://github.com/moons-14)! - webforai can now be run from the cli

### Patch Changes

- [#31](https://github.com/inaridiy/webforai/pull/31) [`b13719f`](https://github.com/inaridiy/webforai/commit/b13719fd719511d0aeb1ef3749e88fd8145337a6) Thanks [@moons-14](https://github.com/moons-14)! - PRESET_EXTRACT_HAST and DEFAULT_EXTRACT_HAST can be referenced externally

## 1.4.1

### Patch Changes

- [#27](https://github.com/inaridiy/webforai/pull/27) [`fd7348f`](https://github.com/inaridiy/webforai/commit/fd7348f59a19a027b9bdf012b11d40c38d56cf61) Thanks [@inaridiy](https://github.com/inaridiy)! - Improve extract algorithm

## 1.4.0

### Minor Changes

- [#25](https://github.com/inaridiy/webforai/pull/25) [`5bdea98`](https://github.com/inaridiy/webforai/commit/5bdea98cc7cafd79020123260db721fc6ffefd87) Thanks [@moons-14](https://github.com/moons-14)! - Add loader using puppeteer

## 1.3.3

### Patch Changes

- [#20](https://github.com/inaridiy/webforai/pull/20) [`c5e8416`](https://github.com/inaridiy/webforai/commit/c5e841610360346fcba388c777869706dcd5997d) Thanks [@inaridiy](https://github.com/inaridiy)! - Minimal Param update

- [#22](https://github.com/inaridiy/webforai/pull/22) [`97863ea`](https://github.com/inaridiy/webforai/commit/97863ea7f9f4837b96f376bd33371c6ed756d791) Thanks [@inaridiy](https://github.com/inaridiy)! - Add fetch loader and improve playwright loader

## 1.3.2

### Patch Changes

- [#18](https://github.com/inaridiy/webforai/pull/18) [`3c6da39`](https://github.com/inaridiy/webforai/commit/3c6da3952f176769cf8aa899f6c7207c231d806a) Thanks [@inaridiy](https://github.com/inaridiy)! - Improve

- [#18](https://github.com/inaridiy/webforai/pull/18) [`4437e28`](https://github.com/inaridiy/webforai/commit/4437e28e1e7807fd061aee99510ea2d3f71a2a78) Thanks [@inaridiy](https://github.com/inaridiy)! - accuracy improvement

- [#18](https://github.com/inaridiy/webforai/pull/18) [`4764767`](https://github.com/inaridiy/webforai/commit/47647676a838b922e2cf32b1d3637c8153b996dd) Thanks [@inaridiy](https://github.com/inaridiy)! - Minor performance improvements

## 1.3.1

### Patch Changes

- [#15](https://github.com/inaridiy/webforai/pull/15) [`680a226`](https://github.com/inaridiy/webforai/commit/680a22638409517658c3918d90d070b1fa53cc3f) Thanks [@inaridiy](https://github.com/inaridiy)! - Update Document

## 1.3.0

### Minor Changes

- [#12](https://github.com/inaridiy/webforai/pull/12) [`5e188a7`](https://github.com/inaridiy/webforai/commit/5e188a7c4d386e6351a5120213f18948ec5ec6f7) Thanks [@inaridiy](https://github.com/inaridiy)! - Minor interface improvements.

## 1.2.3

### Patch Changes

- [`ba73738`](https://github.com/inaridiy/webforai/commit/ba73738c24f509c8f1f060f0314bc0c6e3abc953) Thanks [@inaridiy](https://github.com/inaridiy)! - Update Workflow

- [`663b15d`](https://github.com/inaridiy/webforai/commit/663b15d87a3085ef1d1657dd73a637e43aa4340b) Thanks [@inaridiy](https://github.com/inaridiy)! - Update Workflows

## 1.2.2

### Patch Changes

- 920f310: Update Linter and Workflows
