# README benchmarks and more competitors (Cloudflare toMarkdown, hosted Firecrawl)

Owner request (2026-10-09): make the README elegant and convincing by publishing accuracy and
speed against Readability + Turndown and Defuddle; then also benchmark Cloudflare's
`toMarkdown` and Firecrawl. Stacked on the package split (#84); PR #85.

## Progress

- [x] (2026-10-09) Chart generator `site/scripts/benchmark-chart.mjs` (light/dark SVG, highlight-one
      palette checked with the dataviz validator; grey is de-emphasis, every bar direct-labelled,
      the README keeps the full table under `<details>`). READMEs, landing page and `/benchmarks`
      lead with it. Commit 2367b42.
- [x] (2026-10-09) Cloudflare toMarkdown as an evals pipeline: helper Worker
      `evals/workers/cf-tomarkdown` (AI binding, run under `wrangler dev`, so it uses wrangler's
      login instead of a copied token), runner `cf-tomarkdown`, cache `.cache/cf-tomarkdown`,
      competitor `cf-tomarkdown` (`extracts: false`). Corpus: 61 pages, 0 failures.
- [x] (2026-10-09) toMarkdown over WCEB (3,985 pages, 0 failures). `gold:eval`: F1 0.713 / 0.702
      (pages / datasets), P 0.604, R 0.985 — between Firecrawl OSS and full-page Turndown on every
      dataset, below webforai on all eight. Full-page Turndown scored on WCEB for context: 0.676 /
      0.671, 84 crashes. `bench:compare` re-run for all 7 pipelines at 2367b42 (load ≈ 3):
      webforai 75/75 checks, 3.95 s; Readability + Turndown 13.09 s; Defuddle 14.02 s; toMarkdown
      62/75, code 53.6%, tables 57.8%. Chart (5 pipelines; services not timed), READMEs, landing,
      `/benchmarks` (pipelines, results, WCEB, revision note, reproduce) and `evals/README.md`
      updated.
- [x] (2026-10-09) Hosted Firecrawl: owner chose not to run it; Firecrawl OSS stays the Firecrawl
      row.

## Decision log

- (2026-10-09) toMarkdown runs with defaults (no `cssSelector`, no `hostname`), like every other
  pipeline. Per Cloudflare's docs it drops `script`/`style`/`header`/`footer`/`head`, does not
  look for the main content, prepends page metadata as front matter and appends JSON-LD; so it
  is classed with the full-page baselines.
- (2026-10-09) Its time is the `env.AI.toMarkdown` call measured inside the Worker (Cloudflare
  round trip included): a service latency, reported like Firecrawl's and not comparable with
  in-process conversion.
- (2026-10-09) Hosted Firecrawl can convert supplied HTML only through `/v2/parse` (HTML file
  upload, `onlyMainContent` on by default, 1 credit per file). `/scrape` needs a public URL, and
  most WCEB URLs are dead, so `/parse` is the only same-input comparison. Firecrawl OSS is
  already in the harness.
