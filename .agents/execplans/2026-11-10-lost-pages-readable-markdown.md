# Fewer lost pages, Markdown that reads as written

Requested by the owner on 2026-11-10: find what the mean scores do not show, fix it, and publish
the measurements. Mean token F1 puts webforai a few hundredths ahead of other extractors; the
difference a reader notices is in the pages a converter loses and in the Markdown itself.

## What was measured first

- **Lost pages.** From the saved per-page results of `gold:eval`: how often a pipeline's output is
  not the page's content (F1 under 0.2) or misses half of it (recall under 0.5). `gold:eval
  --lost` now prints this for saved runs.
- **The Markdown itself.** `prefer` (new): a blinded pairwise comparison of two conversions of
  the same page, judged by a model in both A/B orders. Token F1 cannot see a code block run into
  one line or a link list between two sentences; this does. The judges' issue lists were read
  page by page to find the defects fixed below.

## Changes

Extraction (pages that came out empty or cut):

- Section wrappers looked through when the heuristic extractor climbs (Asciidoctor's `div.sect1`):
  the Gradle compatibility page lost four of its five sections.
- `<noscript>` fallback converted when it holds the page (Discourse, Flarum).
- Listing whose items the models score 0.2–0.45 kept when it would otherwise collapse to a title.
- Content React streamed after the shell put back before extraction (`utils/react-streaming.ts`).
- Definition terms kept with their descriptions; code kept across furniture the models are sure of.

Conversion (what a reader of the Markdown sees):

- Code lines of Shiki blocks without newline text; Sphinx's `highlight-<language>` wrapper.
- `baseUrl` defaults to `url`; `&` escaped only where a character reference would start.
- Repeated images, sign-only heading permalinks, a heading printed twice.
- Note, tip and warning boxes as block quotes with a bold title.

## Progress

- [x] 2026-11-10 Three extraction fixes from 2026-10-12 rebased onto main (`0b17879`, `7b56abb`,
      `506f959`). WCEB page F1 +0.0050 [+0.0033, +0.0069], WCXB-dev +0.0136 [+0.0079, +0.0190]
      (forum pages under F1 0.2: 23.9% → 7.1%), WebMainBench +0.0016 [+0.0005, +0.0028].
- [x] 2026-11-10 Conversion fixes (`9cfd015`, `7d5be4d`, `47e238d`, `2b376fe`): 55 of 120 corpus
      outputs change; token F1 unchanged on every set, as expected.
- [x] 2026-11-10 Streamed content (`140f26b`): 15 WCXB-dev pages change, 12 better (five articles
      from 0.0 to 0.97), 3 worse; WCEB and WebMainBench unchanged.
- [x] 2026-11-10 Keep rules (`a7a48c1`): 192 of 13,291 pages change (118 better, 74 worse), mean
      F1 ±0.000 on WCEB, WCXB-dev and WebMainBench.
- [x] 2026-11-10 Evals: `gold:eval --lost`, `prefer`, Defuddle 0.19.4 → 0.19.6.
- [ ] Release run: `gold:eval` on WCEB, WebMainBench, WCXB-dev and WCXB-test; `bench:compare`;
      `prefer` on the corpus and WCXB-test with two judges; `stress`.
- [ ] Benchmarks page, READMEs and chart rewritten around the three questions (is the page kept,
      is the Markdown good to read, what does it cost).

## Decision log

- 2026-11-10 Two experiments were measured and dropped. Lowering the threshold for a page until
  a character budget is filled: no better than a plain lower threshold on recall for the tokens
  spent, and mean F1 falls (0.864 → 0.760 at 4,000 characters on 1,302 WebMainBench pages).
  Lowering the threshold only between the first and the last kept block: F1 ±0 to −0.002, more
  pages worse than better. Structure-specific keep rules were added instead.
- 2026-11-10 `prefer` reports WCXB-test (held out; no change was chosen on it) apart from the
  corpus, whose pages the fixes were developed on and whose result therefore flatters webforai.
- 2026-11-10 `baseUrl` defaulting to `url` changes output for callers that passed only `url`
  (relative links become absolute): a minor version, with `baseUrl: ""` as the way back.
