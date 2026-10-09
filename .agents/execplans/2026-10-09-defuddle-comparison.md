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
- [ ] Library: multi-column tables without block content are data tables (from Defuddle).
- [ ] Library: drop an `aria-hidden` element that repeats a sibling's text.
- [ ] Attribution: THIRD_PARTY_NOTICES with Defuddle's MIT notice, shipped in the package.
- [ ] Re-run `bench:compare` and `gold:eval`; update the summary JSON and the Benchmarks page.
- [ ] Validation: biome, typecheck, tests, build; changeset; PR.

## Decision log

- Defuddle runs as its README documents for Node — a linkedom document passed to
  `defuddle/node` with `markdown: true` — because the browser bundle's Markdown conversion needs a
  global `document`. `useAsync: false` keeps it offline like every other pipeline. The harness's
  `convert` may now return a promise; `bench:compare` times the awaited call.
- License: Defuddle is MIT. The adopted ideas are reimplemented on hast, not copied, but each
  place they come from Defuddle names it, and the package ships Defuddle's copyright and
  permission notice in `THIRD_PARTY_NOTICES.md` so attribution travels with the code.
