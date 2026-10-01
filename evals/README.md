# @webforai/evals

Accuracy and performance harness for `webforai`. Private to the repository — never published.

## Why it exists

Extraction heuristics cannot be judged from unit tests on hand-written HTML. Every improvement
here was measured against real captures of real sites, and every regression documented in
`src/assertions.ts` was one this harness caught.

## Corpus policy

**Page HTML is never committed.** `src/corpus.ts` holds only URLs; captures are fetched into
`evals/.cache/` which is gitignored. The cache is third-party content, would add tens of
megabytes to the repository, and goes stale within weeks.

What *is* committed is `src/assertions.ts`: short, factual anchors (heading counts, code-block
counts, the presence of a specific structural marker, the absence of a specific piece of page
chrome). These survive routine copy edits, so the suite catches extraction regressions without
failing every time a publisher rewords a paragraph.

## Setup

```bash
pnpm install
pnpm --filter @webforai/evals exec playwright-core install chromium   # for rendered captures
pnpm --filter @webforai/evals corpus:fetch
```

Roughly 60 captures, about 25 MB. Fetching takes a few minutes.

### Optional: outbound proxy

Some publishers block datacenter egress. Create a gitignored `.env` at the repository root:

```sh
# A proxy-list download endpoint (`ip:port:user:pass` lines); the harness caches and rotates the list.
WEBFORAI_PROXY_LIST_URL=https://<your-proxy-provider>/list/download/<token>/...

# Or a single proxy.
WEBFORAI_PROXY_URL=http://user:pass@198.51.100.7:6540
```

Fetching always tries a direct connection first and only falls back to the pool, because for most
sites the direct route is both faster and more reliable.

## Commands

| Command | What it does |
| --- | --- |
| `corpus:fetch` | Populate the cache. `--force`, `--only=id1,id2`, `--category=`, `--concurrency=` |
| `corpus:status` | List which captures are missing |
| `report` | Convert every capture and tabulate size, timing and structure. `--write` dumps the Markdown |
| `compare` | Run the working tree and the published v2 baseline over the same input |
| `bench` | End-to-end throughput, interleaved and median-of-N |
| `bench:extract` | Extraction stage in isolation, with parsing outside the timed region |
| `bench:compare` | webforai against Readability + Turndown, full-page Turndown and node-html-markdown. `--rounds=`, `--no-summary` |

The accuracy suite runs under the repository's vitest:

```bash
npx vitest run evals/src/corpus.test.ts
```

It skips any site that is not cached, so it is meaningful locally and harmless in CI.

## Cross-tool comparison

`bench:compare` scores every pipeline in `src/competitors.ts` with the existing assertions (minus
the webforai-specific ones it lists) and the signals defined in `src/compare-metrics.ts`. It
writes per-capture results, a report and every output to `.reports/<date>-compare/`, and rewrites
the committed aggregate `benchmarks/compare-summary.json`, which the site's Benchmarks page
quotes. jsdom 30, used for the Readability pipeline, needs Node 22.22.2+ or 24.15.0+.

## Reading the numbers

`report` and `compare` print a `navL%` column: the share of non-blank output lines that consist
solely of a link. It is the most sensitive single indicator that navigation leaked into the
output — prose sits near zero, a leaked sidebar pushes it above 20%.

Be careful with the end-to-end timings in `compare`: single-pass numbers on this workload swing
by tens of percent between runs. Use `bench`, which interleaves both versions and reports a
median, before claiming a speed difference.
