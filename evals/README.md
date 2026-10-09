# @webforai/evals

Accuracy and performance harness for `webforai`. Private to the repository — never published.

## Why it exists

Extraction — heuristics and the learned block classifier alike — cannot be judged from unit tests on hand-written HTML. Every improvement
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

**Requirements:** Node 22.22.2+ or 24.15.0+ (jsdom 30, used for the Readability pipeline). The
Defuddle pipeline parses with linkedom and runs offline (`useAsync: false`).
Note that `bench:compare` rewrites the committed `benchmarks/compare-summary.json`.

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

Run each as `pnpm --filter @webforai/evals <command>` (pass flags after `--`).

| Command | What it does |
| --- | --- |
| `corpus:fetch` | Populate the cache. `--force`, `--only=id1,id2`, `--category=`, `--concurrency=` |
| `corpus:status` | List which captures are missing |
| `report` | Convert every capture and tabulate size, timing and structure. `--write` dumps the Markdown |
| `compare` | Run the working tree and the published v2 baseline (`webforai@2.1.1`) over the same input |
| `bench` | End-to-end throughput, interleaved and median-of-N (unrelated to `examples/bench`, which is an unscored by-eye demo) |
| `bench:extract` | Extraction stage in isolation, with parsing outside the timed region |
| `bench:compare` | webforai against Readability + Turndown, Defuddle, full-page Turndown, node-html-markdown and Firecrawl OSS. `--rounds=`, `--no-summary` |
| `firecrawl-oss` | Run a self-hosted Firecrawl over the corpus and WCEB and cache its Markdown for the `firecrawl-oss` pipeline (see below) |
| `stress` | Adversarial and very large pages, each in a child process with a 128 MB heap (a Worker's budget). `--case=` |

The accuracy suite runs under the repository's vitest:

```bash
npx vitest run evals/src/corpus.test.ts
```

It skips any site that is not cached, so it is meaningful locally and harmless in CI.

## Ground truth

The corpus above has assertions, not answers. `gold:eval` scores extraction against reference
main-content text instead: token precision, recall and F1 per page, averaged per dataset.

| Command | What it does |
| --- | --- |
| `gold:fetch-wceb` | Download WCEB (Bevendorff et al., SIGIR 2023; Apache-2.0, ≈50 MB) into the cache |
| `gold:eval` | Token precision/recall/F1 against WCEB's reference text. `--pipelines=webforai,webforai-kiwame,readability-turndown`, `--impl=<path>` to measure another checkout, `--threshold=`, `--limit=` |

Pipelines: `webforai` is the published entry point with its defaults (kiwame), or the build at
`--impl`; `webforai-kiwame` builds the kiwame extractor from source so `--threshold=` and
`--no-stack` can vary it; the rest are the competitors in `src/competitors.ts`.

The learned block classifier's weights (`packages/webforai/src/extractors/lib/block-model.generated.ts`)
are generated outside this repository; WCEB is used to measure them, never to tune them.

## Cross-tool comparison

`bench:compare` scores every pipeline in `src/competitors.ts` with the existing assertions (minus
the webforai-specific ones it lists) and the signals defined in `src/compare-metrics.ts`. It
writes per-capture results, a report and every output to `.reports/<date>-compare/`, and rewrites
the committed aggregate `benchmarks/compare-summary.json`, which the site's Benchmarks page
quotes. jsdom 30, used for the Readability pipeline, needs Node 22.22.2+ or 24.15.0+.

## Firecrawl OSS

Firecrawl is a service, so `bench:compare` and `gold:eval` read its output from
`.cache/firecrawl/` (keyed by the HTML's hash) instead of converting in-process. To refresh it,
run Firecrawl from its repository (AGPL-3.0; nothing of it is vendored here) with the browser
engine disabled, so it converts exactly the cached HTML, and local fetching allowed:

```yaml
# docker-compose.override.yaml in the Firecrawl checkout
services:
  api:
    environment:
      PLAYWRIGHT_MICROSERVICE_URL: ""
      ALLOW_LOCAL_WEBHOOKS: "true"
      TEST_SUITE_SELF_HOSTED: "true"
```

```bash
docker compose up -d                       # in the Firecrawl checkout
# from evals/, so $PWD/.cache is evals/.cache
docker run -d --name fc-stage --network firecrawl_backend -v "$PWD/.cache/fc-stage:/usr/share/nginx/html:ro" nginx:alpine
pnpm --filter @webforai/evals firecrawl-oss -- --sets=corpus,wceb --commit=<firecrawl commit> \
  --stage-dir=.cache/fc-stage --serve-base=http://<fc-stage container IP>
```

With rootful Docker the stage container is unnecessary: omit `--stage-dir`, and the script serves
the pages itself on `--serve-host` (the host's address on Docker's bridge).

## Reading the numbers

`report` and `compare` print a `navL%` column: the share of non-blank output lines that consist
solely of a link. It is the most sensitive single indicator that navigation leaked into the
output — prose sits near zero, a leaked sidebar pushes it above 20%.

Be careful with the end-to-end timings in `compare`: single-pass numbers on this workload swing
by tens of percent between runs. Use `bench`, which interleaves both versions and reports a
median, before claiming a speed difference.
