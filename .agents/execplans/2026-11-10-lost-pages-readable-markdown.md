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
- [x] 2026-11-10 Release run at `a5831e6` (library code final at `2b376fe`). `gold:eval` page F1:
      WCEB 0.896 (comments 0.924), WebMainBench 0.860, WCXB-dev 0.844, WCXB-test 0.877 — ahead of
      Defuddle 0.19.6 (+0.022 [+0.007, +0.038]), Trafilatura (+0.018 [+0.001, +0.035]) and
      Readability + Turndown (+0.046 [+0.026, +0.067]) on the held-out split. Pages with recall
      under 0.5 on WebMainBench: 5.1% against 10.2–12.6%. `bench:compare` (at `5d76f8d`): checks
      75/75, code 736/750, empty outputs 4 → 2, 4.12 s for the corpus against 13.02 s for
      Readability + Turndown; an interleaved run against the previous release measured 0.96×.
      `stress`: every case within the 128 MB heap.
- [x] 2026-11-10 `prefer`, WCXB-test, 105 pages, both orders: against Readability + Turndown
      Sonnet 5.5 72% / 20% and gpt-6.1-sol 71% / 22%; against Defuddle 51% / 38% and 51% / 41%
      (net +13 [−4, +29] and +10 [−8, +28]: no clear preference). Corpus (46 sites, Sonnet):
      90% / 7% and 67% / 25%. Summary in `evals/benchmarks/preference/results.json`.
- [x] 2026-11-10 Code probe fixed for every pipeline: Shiki's `span.line` lines were read as one
      joined line when the page has no newline between them, so the broken output passed and the
      correct one failed (probes 748 → 750).
- [x] 2026-11-10 Benchmarks page (newer sets, pages lost, preference; WCEB and corpus tables
      re-measured), READMEs and docs home rebuilt around three questions — is the page kept, is
      the Markdown good to read, what does agent mode cost — and the chart redrawn to match
      (held-out F1, pages lost, code blocks kept).

- [x] 2026-11-10 Review before release (`5d76f8d`): eight defects reproduced and fixed — a
      backtracking regex in the ampersand un-escaping (160 KB of backslashes: 56 s → 36 ms), a
      quadratic definition-term rule (40 s → 0.6 s), a RangeError and a quadratic path in the
      streamed-content step (segments are concatenated; at most 1,000 per page), inline code in a
      link losing a backslash, check marks in table cells and rating stars taken for repeated
      images, GitHub's `highlight-*` classes read as a language, image-only headings taken for a
      repeated heading. Corpus outputs unchanged (0 of 120); the four reference sets re-scored.

## Decision log

- 2026-11-10 Two experiments were measured and dropped. Lowering the threshold for a page until
  a character budget is filled: no better than a plain lower threshold on recall for the tokens
  spent, and mean F1 falls (0.864 → 0.760 at 4,000 characters on 1,302 WebMainBench pages).
  Lowering the threshold only between the first and the last kept block: F1 ±0 to −0.002, more
  pages worse than better. Structure-specific keep rules were added instead.
- 2026-11-10 `prefer` reports WCXB-test (held out; no change was chosen on it) apart from the
  corpus, whose pages the fixes were developed on and whose result therefore flatters webforai.
- 2026-11-10 The README no longer says "best quality". What was measured supports narrower
  statements — fewer lost pages and a higher F1 than the other extractors on held-out pages,
  preferred to Readability + Turndown — and does not support a preference over Defuddle.
- 2026-11-10 WCXB-test was measured once, at the release commit. The judges' reasons on its
  pages were read to describe the result on the benchmarks page; no change was made from them.
- 2026-11-10 `baseUrl` defaulting to `url` changes output for callers that passed only `url`
  (relative links become absolute): a minor version, with `baseUrl: ""` as the way back.
