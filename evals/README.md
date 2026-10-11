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

# Where the downloaded list is kept (default evals/.cache/proxies.txt); a path outside the repository keeps the credentials out of it.
WEBFORAI_PROXY_LIST_FILE=/path/outside/the/repo/proxies.txt
```

`corpus:fetch` tries a direct connection first and only falls back to the pool, because for most
sites the direct route is both faster and more reliable. The link benchmarks render their pages
through the pool ([below](#link-benchmarks-agent-mode)).

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
| `cf-tomarkdown` | Run Cloudflare Workers AI `toMarkdown` over the corpus and WCEB through a local helper Worker and cache its Markdown for the `cf-tomarkdown` pipeline (see below) |
| `trafilatura` | Run Trafilatura (Python, via `uv`) over the corpus and the reference sets and cache its Markdown for the `trafilatura` pipeline (see below) |
| `stress` | Adversarial and very large pages, each in a child process with a 128 MB heap (a Worker's budget). `--case=` |

The accuracy suite runs under the repository's vitest:

```bash
npx vitest run evals/src/corpus.test.ts
```

It skips any site that is not cached, so it is meaningful locally and harmless in CI.

## Ground truth

The corpus above has assertions, not answers. `gold:eval` scores extraction against reference
main-content text instead: token precision, recall and F1 per page, averaged per dataset. No
model or LLM is involved in scoring.

| Set (`--sets=`) | What it is | Reference | Fetch |
| --- | --- | --- | --- |
| `wceb` (default) | WCEB (Bevendorff et al., SIGIR 2023): 3,985 pages from eight datasets, mostly news 2007–2017. Apache-2.0 | plain text | `gold:fetch-wceb` (≈50 MB) |
| `wcxb-test`, `wcxb-dev` | WCXB v1.0 (Foley, arXiv:2605.21097): 511 / 1,497 pages in seven page types (article, forum, product, collection, listing, documentation, service). CC BY 4.0 | plain text; scored with its own tokenizer (`\w+`, lower-cased), as its `evaluate.py` does | `gold:fetch-wcxb` (≈85 MB) |
| `webmainbench` | WebMainBench (OpenDataLab, arXiv:2511.23119): 7,809 human-annotated pages, 46 languages, split simple / mid / hard. Apache-2.0 | `convert_main_content` (html2text Markdown of the annotated main HTML) | `gold:fetch-webmainbench` (1.35 GB) |

| Command | What it does |
| --- | --- |
| `gold:eval` | Token precision/recall/F1 against a set's reference text. `--sets=`, `--pipelines=webforai,webforai-kiwame,readability-turndown`, `--impl=<path>` to measure another checkout, `--threshold=`, `--limit=`, `--name=` (report file prefix), `--save-outputs` (also write each page's Markdown) |
| `gold:eval -- --compare=<a>,<b>` | Paired difference of two saved runs (`.reports/gold/<a>.jsonl`, e.g. `current-webforai-comments`): mean F1 over pages and over datasets, with 95% intervals from a bootstrap stratified by dataset |
| `gold:rouge-webmainbench` | WebMainBench's published metric (ROUGE-5 F1 over jieba tokens, MD mode) for outputs saved with `--sets=webmainbench --save-outputs`; needs `uv` |

The two WebMainBench numbers differ on purpose. The token F1 ignores formatting, like the WCEB
and WCXB scores. ROUGE-5 is what the Dripper paper's leaderboard reports: it counts every jieba
token, spaces and punctuation included, so it also rewards matching html2text's Markdown style
(`*` bullets, indented code). It is computed by copying MinerU-HTML's `calc_rouge_n_score`:

```bash
pnpm --filter @webforai/evals gold:eval -- --sets=webmainbench --save-outputs --pipelines=webforai,trafilatura
pnpm --filter @webforai/evals gold:rouge-webmainbench .reports/gold/current-webforai.outputs.jsonl .reports/gold/current-trafilatura.outputs.jsonl
```

The page HTML of WebMainBench carries its annotation (`cc-select`, `data-anno-uid`); every pipeline
receives it unchanged, as the benchmark's own baselines do, and none of them reads it.

Pipelines: `webforai` is the published entry point with its defaults (kiwame), or the build at
`--impl`; `webforai-kiwame` builds the kiwame extractor from source so `--threshold=` and
`--no-stack` can vary it; `webforai-comments` is the `comments` preset (reader comments kept, as
Trafilatura keeps them by default); `webforai-nolinks` writes links as text and drops images; the rest
are the competitors in `src/competitors.ts`.

The learned block classifier's weights (`packages/webforai/src/extractors/lib/block-model.generated.ts`)
are generated outside this repository; WCEB, WCXB and WebMainBench are used to measure them,
never to train them. Treat `wcxb-test` as held out: measure a release on it, do not iterate
against it. WebMainBench was held out too until its misses led to the unpadded tables of v5.

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

## Cloudflare toMarkdown

`toMarkdown` runs on Cloudflare, so its output is cached in `.cache/cf-tomarkdown/` the same way.
The helper Worker in `workers/cf-tomarkdown/` posts each page's HTML to `env.AI.toMarkdown()` with
default options; under `wrangler dev` the AI binding calls Cloudflare with wrangler's login, so no
API token is stored here. Cloudflare documents toMarkdown as free for most formats (only image
descriptions use billed models), but it runs under your account.

```bash
npx wrangler login                          # once; any account with Workers AI
pnpm --filter platform exec wrangler dev --config ../../evals/workers/cf-tomarkdown/wrangler.jsonc --port 8799
CF_TOMARKDOWN_URL=http://localhost:8799 pnpm --filter @webforai/evals cf-tomarkdown -- --sets=corpus,wceb
```

Cloudflare does not version the service; each cached record carries the run date, which
`bench:compare` reports.

## Trafilatura

Trafilatura is a Python library, so its output is cached in `.cache/trafilatura/` too. The
harness starts Python workers with `uv run --script python/trafilatura_worker.py`, which installs
the pinned Trafilatura (2.3.1) on first use, and sends each page's HTML to
`trafilatura.extract(html, url=url, output_format="markdown")` with every other option at its
default (comments and tables included, no links or images).

```bash
pnpm --filter @webforai/evals trafilatura -- --sets=corpus --rounds=5 --concurrency=1   # timed
pnpm --filter @webforai/evals trafilatura -- --sets=wceb,wcxb-test,webmainbench --concurrency=8
```

Its time is measured in Python around the `extract` call (median of `--rounds` after a warm-up):
in-process like webforai's, but in another runtime.

## Link benchmarks (agent mode)

Does a converter's output keep the link an agent has to follow next, and can a model pick it?
Two kinds of task, scored the same way:

- **WebWalkerQA** (Wu et al., arXiv:2501.07572; [Apache-2.0](https://huggingface.co/datasets/callanwu/WebWalkerQA)):
  click paths through conference, society and organisation sites. Used during development.
- **related-hops**: start pages from Common Crawl (under its [terms of use](https://commoncrawl.org/terms-of-use))
  where the link to follow is a related or next article. `related-hops-2` is the holdout. What
  the task lists hold and how they were built: [`benchmarks/README.md`](benchmarks/README.md).

Pages are rendered live in headless Chromium through the proxy pool, one request at a time per
host. A page that does not load is tried through up to two other proxies; a site that refuses a
request (HTTP 403 or 429) drops the page.

| Command | What it does |
| --- | --- |
| `webwalker:fetch` | Follow WebWalkerQA's paths on the live sites; cache the pages and the clicks (`hops.jsonl`). `--direct` fetches without a proxy |
| `webwalker:links` | Convert each page with every pipeline: is the next link kept, and at how many tokens. `--set=`, `--report` (score the saved outputs, convert nothing), `--save-results` (write `benchmarks/<set>/results.json`) |
| `webwalker:choose` | A model picks the next link from each output. `--set=`, `--models=haiku,sonnet,codex`, `--reps=`, `--report` (no model calls), `--save-results`, `--migrate` (move answers cached under task-index names) |
| `related-hops:build` | Build a related-hops set in stages (the steps are in `src/cli/related-hops-build.ts`), or `--stage=fetch` to render the start pages of a committed set |

Prerequisites: Chromium for playwright-core (`playwright-core install chromium`, or
`WEBWALKER_CHROMIUM=<path to a binary>`); a proxy (see above) or `--direct`; `uv` for Trafilatura
and the token count. `webwalker:choose` and the build's label, question and verify stages call
the `claude` and `codex` CLIs, which must be logged in — with an API key for runs of this size.
The build's candidate stage streams Common Crawl files with `curl` and `gzip`.

To score the committed holdout:

```bash
pnpm --filter @webforai/evals related-hops:build -- --set=related-hops-2 --stage=fetch
pnpm --filter @webforai/evals webwalker:links -- --set=related-hops-2 --save-results
pnpm --filter @webforai/evals webwalker:choose -- --set=related-hops-2 --models=haiku,sonnet --reps=3 --save-results
```

The pages have changed since the set was frozen, so a fresh fetch scores close to, not exactly,
the numbers in `benchmarks/related-hops-2/results.json`. Building a new set needs
`--exclude-hosts`, the hosts agent mode's role models were trained on, which is not published:
the task lists and the scoring can be reproduced, the selection of start pages cannot.

## Reading the numbers

`report` and `compare` print a `navL%` column: the share of non-blank output lines that consist
solely of a link. It is the most sensitive single indicator that navigation leaked into the
output — prose sits near zero, a leaked sidebar pushes it above 20%.

Be careful with the end-to-end timings in `compare`: single-pass numbers on this workload swing
by tens of percent between runs. Use `bench`, which interleaves both versions and reports a
median, before claiming a speed difference.
