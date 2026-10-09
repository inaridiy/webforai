# Defuddle comparison and adopted ideas

Compare webforai with [Defuddle](https://github.com/kepano/defuddle) (MIT, © 2025 Steph Ango),
keep the comparison in the evaluation harness and the published benchmarks, and adopt the parts
of Defuddle that the comparison shows webforai lacks. Owner request (2026-10-09): save the
benchmark results, bring in Defuddle's strengths such as table preservation, and respect its MIT
license — anything taken from it is attributed explicitly, never copied silently.

## Baseline (main 84e86fd, Defuddle 0.19.4 via linkedom, `useAsync: false`)

WCEB, 3985 pages (`gold:eval`):

| Pipeline | mean page F1 | macro F1 over groups | P / R | crashes | time |
| --- | ---: | ---: | ---: | ---: | ---: |
| webforai | 0.892 | 0.918 | 0.922 / 0.909 | 0 | 71 s |
| Readability + Turndown | 0.880 | 0.917 | 0.917 / 0.892 | 14 | 299 s |
| Defuddle | 0.820 | 0.860 | 0.869 / 0.856 | 0 | 399 s |
| Firecrawl OSS | 0.743 | 0.761 | 0.668 / 0.939 | 0 | — |

Corpus (`bench:compare`, 3 rounds): webforai 74/74 checks, code fenced 98.0%, tables 35.9%
(23/64), 3.8 s; Defuddle 72/74, 89.2%, 54.7% (35/64), 17.6 s.

## What the comparison found

- The table-recall gap is almost all Wikipedia navboxes: on the Japanese capture 30 of 33 source
  tables are `navbox` navigation; both tools keep the two `wikitable`s. Not a gap to close.
- Real gaps, both on the Amazon product page:
  1. Two-column specification tables without `<th>` (5×2 and 5×2) are flattened into
     paragraphs: `isLayoutTable` follows Readability's `rows × columns ≤ 10 → layout`. Defuddle
     treats a table as layout only when it is single-column or nests tables, and keeps them.
  2. Cell text is doubled ("…ManualTransmitter, …"): Amazon's truncation widget holds the text
     twice, once as screen-reader text (`a-offscreen`) and once as an `aria-hidden="true"` visual
     copy. Defuddle removes `[aria-hidden="true"]` (except math, SVG and paywall markers);
     webforai deliberately does not, because `aria-hidden` also marks visible decorative content.
- WCEB pages where Defuddle beats webforai by > 0.2 F1 (89; the reverse: 427) are mostly the
  benchmark's inconsistent treatment of comments (dragnet counts them as content, L3S does not)
  and link-list pages; Defuddle wins those by keeping the whole page. Nothing general to adopt.
- Out of scope, noted for later: Defuddle's site extractors (Reddit, X, Bluesky, Mastodon,
  Threads, ChatGPT/Claude/Gemini/Grok conversations, Medium, NYTimes, LWN, Discourse, LeetCode…).

## Progress

- [x] (2026-10-09) Evals: Defuddle as a permanent `bench:compare` / `gold:eval` pipeline
      (`evals/src/competitors.ts`, devDependencies `defuddle` 0.19.4 and `linkedom` 0.18.13).
- [x] (2026-10-09) Library: a small table (≤ 10 cells, ≥ 2 rows and columns) is data when its
      longest cell is ≤ 150 characters and at most half its text is link text
      (`isLayoutTable`, adapted from Defuddle). Tests in `layout-tables.test.ts` and
      `extractors.test.ts`.
- [x] (2026-10-09) Library: an `aria-hidden` element whose collapsed text equals a visible
      sibling's is dropped in `stripNonContent` (found in the same traversal as code tabs).
- [x] (2026-10-09) Attribution: `packages/webforai/THIRD_PARTY_NOTICES.md` (Defuddle's MIT
      notice), listed in the package's `files`; source comments name Defuddle; patch changeset.
- [x] (2026-10-09) Re-run `bench:compare` (5 rounds, load ≈ 4) at 386ca9b and `gold:eval` for
      the built package and Defuddle; `evals/benchmarks/compare-summary.json` and
      `site/docs/pages/benchmarks.mdx` updated with a revision note. webforai tables 35.9% → 39.1%
      (25/64); WCEB unchanged at 0.892 / 0.909 (pages / datasets); Defuddle 0.820 / 0.850.
- [ ] Validation: biome, typecheck, tests, build; changeset; PR.

## Measurements

WCEB, `gold:eval --impl=<checkout>/packages/webforai/src/index.ts`, same cache:

| | mean page F1 | macro F1 over groups | crashes |
| --- | ---: | ---: | ---: |
| main (84e86fd) | 0.892067 | 0.9179 | 0 |
| tables, first cut (short cells only) | 0.892049 | 0.9179 | 0 |
| branch (short cells + link share, aria-hidden copies) | 0.892069 | 0.9179 | 0 |

The first cut changed 8 pages (3 up, 5 down; worst −0.037): two L3S news pages' "Article Tools"
link grids and a Forbes subscription grid became tables, where before they were flattened and
then removed as link clusters by the clean-up. The link-share condition keeps those as layout.
The branch changes 5 pages, 3 up and 2 down (worst −0.0015). Corpus suite 32/32.

## Decision log

- Defuddle runs as its README documents for Node — a linkedom document passed to
  `defuddle/node` with `markdown: true` — because the browser bundle's Markdown conversion needs a
  global `document`. `useAsync: false` keeps it offline like every other pipeline. The harness's
  `convert` may now return a promise; `bench:compare` times the awaited call.
- Small-table thresholds: 150 characters per cell (Amazon's longest spec value is 57; a prose
  cell in a layout grid runs to hundreds) and a link share of 0.5 (a label column of plain text
  and a value column of links is still data). Single-row tables stay layout, unlike Defuddle: a
  one-row GFM table is all header and reads worse than the cells as lines.
- Screen-reader copies: only an exact text match with a sibling that is neither `aria-hidden`
  nor hidden counts, and never a subtree holding math (KaTeX pairs MathML with an `aria-hidden`
  rendering). Defuddle's broader rule (remove every `aria-hidden`) would drop visible text that
  `isHidden` deliberately keeps.
- webforai's empty outputs are 4 in this run against 1 in the 2026-10-01 summary (webforai
  4.0.0). main (84e86fd) already gives 4 — Medium (a 404 capture) and Reddit, static and
  rendered — so it predates this work; recorded on the Benchmarks page, not investigated here.
- License: Defuddle is MIT. The adopted ideas are reimplemented on hast, not copied, but each
  place they come from Defuddle names it, and the package ships Defuddle's copyright and
  permission notice in `THIRD_PARTY_NOTICES.md` so attribution travels with the code.
