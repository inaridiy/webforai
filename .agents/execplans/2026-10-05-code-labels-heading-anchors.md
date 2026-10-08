# Code fence languages, code labels and heading permalinks

Fix four conversion defects found while converting documentation pages (MDN "Closures",
react.dev "Thinking in React", docsify "Quick start") for a downstream consumer (Re:Babel's
born-digital ingest). Owner-approved scope (2026-10-05): A–D below, with focused unit tests and
a WCEB `gold:eval` before/after. Prototype patches were made on `feat/strip-script-bodies`
(9fd7700); this plan ports them to `origin/main` (7deeb4e).

## Defects (observed output before the change)

- MDN: `## [Lexical scoping](#lexical_scoping)`; a stray `js` paragraph above every example,
  then a fence guessed as `ts` (or `plain`) although the `<pre>` says `class="brush: js"`.
- react.dev (Sandpack): JavaScript fenced as `bash`, `html`, `ts` or `plain` although the
  `<pre>` says `sp-javascript`.
- docsify: `## [Initialize](#/quickstart?id=initialize)`; the page ends with
  `Powered by [Docsify.js](…) [Edit Page](…)`.

## Progress

- [x] (2026-10-05) A: `codeLanguage` reads `brush: <lang>` / `brush:<lang>` and Sandpack
      `sp-<lang>` (language names only), after `language-*` classes and `data-language`.
      `detectLanguage` adopts a guess only at score ≥ 400 and returns `undefined` otherwise
      (no `plain`). B: `foldCodeLabels`; C: `unwrapHeadingAnchors` (both `normalizeHast`
      passes, default on, `normalize.codeLabels` / `normalize.headingAnchors`). D: `/^powered
      by\b/i` terminator. Tests in `normalize.test.ts`, `html-to-markdown.test.ts`,
      `extractors.test.ts` (10 new cases fail on main, pass here). Patch changeset.
- [x] (2026-10-05) Validation: biome (no new warnings; KI-1 advisory only), typecheck,
      `pnpm run test --run` (889 pass; only KI-3 Playwright 3 fail), `pnpm build`,
      `gold:eval --impl` main vs branch on WCEB (below).

## Measurements

WCEB, 3985 pages, `gold:eval --impl=<worktree>/packages/webforai/src/index.ts`, same cache:

| | macro F1 over groups | mean page F1 | crashes |
| --- | ---: | ---: | ---: |
| main (7deeb4e) | 0.9179 | 0.892038 | 0 |
| branch | 0.9179 | 0.892067 | 0 |

15 pages change: 12 up, 3 down. The largest drop (cleaneval `bfc504ef…`, −0.014) is a 2006
news homepage whose sidebar shopping widget reads "powered by Shopzilla": the cut removes the
widget and the tail, and the extractor's choice of a dated header line shifts. Accepted: the
page's output is navigation either way, and the net effect is positive.

## Decision log

- Detection threshold 400 (prototype value): decisive patterns score 400–500 per match, so a
  single shebang / `import … from` / Dockerfile `FROM` qualifies, while keyword counts on a
  typical snippet (10 per hit) do not. A wrong info string is worse than none.
- `brush: plain` / a `plain` label name no language: the fence gets no info string.
- Label folding never treats a heading as a label and only fires when the wrapper's children
  are exactly the label and the `<pre>`; the label sets `data-language` only when the `<pre>`
  has none, and class-declared languages still win in the code handler.
- Heading unwrap requires an `href` starting with `#` and anchor text equal to the heading's
  whole text, so links elsewhere and partial in-page links survive. Links are resolved against
  `baseUrl` later (mdast), so `#…` is still visible during normalisation.
- `custom-div-handler.ts` needs no change: it calls `codeLanguage` on the `<code>`, `<pre>` and
  wrapper, so the new conventions apply there too (Sandpack's `sandpack--codeblock` wrapper
  goes through it; covered by a test).
- Out of scope, noted for a separate issue: the evals scorer `markdownToPlain`
  (`evals/src/gold/text-metrics.ts`) strips only fence lines that start with the fence, so a
  fence nested in a list item or blockquote (`- ```js`, `> ```js`) keeps its info string as a
  scored token.
