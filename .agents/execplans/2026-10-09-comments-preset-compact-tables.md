# Comments preset and unpadded tables

Owner request (2026-10-09), after the Trafilatura comparison
(`2026-10-09-trafilatura-wcxb-webmainbench.md`): add a mode that keeps reader comments and show
it, marked, in the comparison with Trafilatura; stop padding Markdown tables. Stacked on
`feat/evals-trafilatura-webmainbench`.

## Why

Analysis of the Trafilatura results (2026-10-09):

- **WCEB, mean over pages** (webforai 0.892, Trafilatura 0.900): Dragnet alone moves the mean by
  −0.018, more than the whole gap; the other seven datasets favour webforai. On the 222 Dragnet
  pages where Trafilatura is more than 0.2 higher, webforai's recall is 0.33 against 0.88, and
  213 of their references contain comment text. Trafilatura keeps comments by default
  (`include_comments=True`); webforai's default does not, by design.
- **WebMainBench ROUGE-5** (webforai 0.585, Trafilatura 0.673): formatting, not selection. With
  Markdown syntax stripped from both sides (same jieba ROUGE-5), webforai 0.822, Trafilatura 0.782,
  Readability + Turndown 0.777; equal precision (0.807 / 0.808), webforai's recall +0.08. Rewriting
  only webforai's output: links and images as text +0.071, tables unpadded +0.036, both +0.123
  (0.707). Table padding (`mdast-util-gfm` `tablePipeAlign`, default on) is 22% of all output
  characters on WebMainBench and 52% on pages with tables; jieba counts each space as a token.

## Progress

- [x] (2026-10-09) `commentsExtractor`, preset `comments`: `createAgentExtractor({ roles: [] })`
      behind the site adapters. CLI, platform schema and playground pick it up from
      `EXTRACTOR_PRESETS`; docs, Agent Skill and changeset updated.
- [x] (2026-10-09) `gfmToMarkdown({ tablePipeAlign: false })` in `DEFAULT_MDAST_TO_MARKDOWN_OPTIONS`.
- [x] (2026-10-09) `gold:eval` pipeline `webforai-comments`.
- [x] (2026-10-09) WCEB and `bench:compare` (Trafilatura included) at `297b7df`; README, landing
      page, `/benchmarks` and chart updated, the comments-preset score marked with `*`.

## Results (297b7df, 2026-10-09)

WCEB (3,985 pages), mean over pages / over the 8 datasets:

| Pipeline | F1 | P / R (pages) |
| --- | ---: | ---: |
| webforai | 0.892 / 0.909 | 0.922 / 0.909 |
| webforai, `comments` | **0.918 / 0.916** | 0.912 / 0.950 |
| Trafilatura | 0.900 / 0.902 | 0.916 / 0.915 |

Paired bootstrap (2,000, stratified by dataset), `comments` − Trafilatura: pages +0.018 [+0.013,
+0.022], datasets +0.014 [+0.008, +0.020]. Per dataset (`comments` / Trafilatura): CETD 0.951 /
0.925, CleanEval 0.914 / 0.882, CleanPortalEval 0.933 / 0.906, Dragnet 0.911 / 0.901, Google
Trends 0.858 / 0.829, L3S-GN1 0.914 / 0.893, Readability 0.935 / 0.935, Scrapinghub 0.912 / 0.948.

Corpus (`bench:compare`): unpadded tables change no check, code or table figure; webforai's median
output 8,461 → 8,207 characters. Trafilatura: 64/75 checks, code 40.6%, tables 26/64, no nav leak,
median 5,630 characters, 2.94 s in Python (webforai 4.04 s in the same summary, not interleaved).

## Decision log

- (2026-10-09) The comments mode is a preset, not the default: WCXB and WebMainBench references
  leave comments out, and the readability output stays the main content only. Comments come from
  the agent extractor's role models (trained on lab data, not on WCEB), unchanged.
- (2026-10-09) The table change is justified by output size (tokens spent on spaces); the
  WebMainBench analysis found it, so WebMainBench is re-measured once for the release, not tuned
  against.
- (2026-10-09) The README states the default score next to the starred one and says that with the
  default extraction Trafilatura is ahead on WCEB's page mean, and that Trafilatura (in Python) is
  faster.
