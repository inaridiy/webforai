# Learned extractor runtime and Worker-safe parsing

Follows [2026-10-01-conversion-accuracy](2026-10-01-conversion-accuracy.md). Adds a learned
block classifier as the default extractor behind the site adapters, and makes parsing safe for a
Cloudflare Worker. The classifier's weights are generated outside this repository
(`packages/webforai/src/extractors/lib/block-model.generated.ts`, do not edit by hand); this plan
covers only the runtime that evaluates them.

## Constraints (owner)

- ESM-native, pure JS; must run inside a Worker (128 MB, CPU-billed). No WASM, no new heavy deps.
- Speed is judged by stable operation on a Worker — bounded time and memory on worst-case pages —
  not by parity with the heuristic extractor (revision 2026-10-01).

## Progress

- [x] (2026-10-01) WCEB ground-truth harness: `gold:fetch-wceb`, `gold:eval` (token P/R/F1).
- [x] (2026-10-01) Runtime: text-block segmentation (`blocks.ts`, shared frame list), per-block
      features (`block-features.ts`, ancestor features memoised per element, iterative), flat
      tree-ensemble evaluator (`block-model.ts`), `takumi_kept` signal (`takumi-signal.ts`, takumi on
      an element-only copy sharing text nodes), `kiwameExtractor` (`presets/kiwame.ts`).
- [x] (2026-10-01) Parsing: `parseHtml` (parse5 without positions, nesting capped at 256 by
      iterative unwrapping with line breaks kept and text coalesced; script/style bodies emptied
      above 2 M chars, JSON-LD kept). Worker stress test `evals stress`.
- [x] (2026-10-01) Default switched: `autoExtractor` falls back to `kiwameExtractor`; CLI
      `--extractor kiwame` (local only), platform presets unchanged.
- [x] (2026-10-01) Validation: WCEB token F1 0.874 → 0.892 (mean over the 8 datasets 0.892 →
      0.903; Readability + Turndown 0.880 / 0.901). 60-page corpus 74/74, code fences 733/748
      (takumi 729), tables 24/64 (takumi 26), nav-leak 5, 2.97 s. Repo tests pass except KI-3;
      platform typecheck, 497 tests and build pass.

## Decision log

- Learned-path post-rules, each to keep content the per-block model is unsure of: `<pre>` is atomic
  when pruning (CodeMirror line `div`s); section headings between kept content are kept; a code
  block with probability ≥ 0.2 and kept content within six blocks on both sides is kept; colon-
  introduced and "See also" link lists are kept as takumi does; a surviving `<form>` becomes a
  `div` (ASP.NET wraps whole pages); tables stay rectangular; layout tables are unwrapped
  (Readability's `_isDataTable` plus "heading, form or table in a cell"; Sphinx `<p>` cells are
  data). If the model keeps nothing, `takumiExtractor` runs.
- Fragment parsing drops a document's leading `<table>` start tag and leaves `tr`/`td` at the top
  level; the learned path treats such stray table parts as containers.
- Worker stress (128 MB per case): before this work 2,000 nested `<div>`s threw `RangeError` in the
  recursive parse5→hast conversion for every extractor. Position-free parsing roughly halves tree
  memory (Amazon capture 133 → 57 MiB). Adjacent text runs are quadratic in
  `hast-util-to-mdast`, so unwrapped deep content is coalesced.
- Known limits: a markup-dense page near the platform's 5 MiB cap (15k-link table of contents)
  needs >128 MB in parse5 alone, for every extractor — route such pages to the container engine.
  One paragraph with ~30k links takes ~2 s in `hast-util-to-mdast` (quadratic splice); unpatched.
- Script/style emptying is limited to very large documents because site adapters read scripts
  (YouTube's player response, MediaWiki configuration).
- `gold:eval`'s "macro over groups" splits tiny CJK subsets into groups of their own; public
  numbers use the mean over WCEB's eight datasets.
- Naming (owner, 2026-10-01): the learned extractor is **kiwame** (極め, an appraiser's verdict) —
  `kiwameExtractor`, `createKiwameExtractor`, `KiwameExtractorOptions`, CLI `--extractor kiwame` —
  paired with the heuristic `takumi` (匠, the craftsman) whose choice it takes into account.
  `auto` keeps kiwame as its default behind the site adapters.
- Naming (owner, 2026-10-01): the learned extractor is **kiwame** (極め, an appraiser's verdict) —
  `kiwameExtractor`, `createKiwameExtractor`, `KiwameExtractorOptions`, CLI `--extractor kiwame` —
  paired with the heuristic `takumi` (匠, the craftsman) whose choice it takes into account.
  `auto` keeps kiwame as its default behind the site adapters.
- Firecrawl comparison (owner, 2026-10-01): self-hosted Firecrawl OSS at commit `034293a`, v2
  scrape defaults (`onlyMainContent: true`), fetch engine only (Playwright rendering would let the
  cached pages' scripts rewrite the DOM and took ~3.6 s/page). Pages served from a container on its
  network (rootless Docker cannot reach the host). Output cached by `firecrawl-oss`; nothing of
  Firecrawl (AGPL-3.0) is vendored. WCEB: F1 0.743 / dataset mean 0.760, precision 0.668 (lowest
  on all 8 datasets), recall 0.939 (highest). Corpus: checks 52/74, nav-leak 15, boilerplate 22.
- Metric revision prompted by Firecrawl: cross-tool output metrics now come from a CommonMark + GFM
  parse (setext headings, indented code, valid tables). The line regexes had counted `# ` code
  comments as headings and credited Turndown's unparseable Sphinx tables. The Python-docs heading
  floor was set from inflated counts; corrected 20 → 19 (its real content headings, all kept).
