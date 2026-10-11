# Benchmark data

- `compare-summary.json` — the aggregate `bench:compare` writes; the site's Benchmarks page
  quotes it.
- `related-hops/`, `related-hops-2/` — next-link tasks for agent mode, described below.

## related-hops and related-hops-2

Each task is a start page, a question and the link on that page that leads to the answer: a
related article, a "read next" link, the previous or next article, a part of a series or the next
page of a listing.

| Set | Tasks | Use |
| --- | ---: | --- |
| `related-hops` | 279 | Development: used to find agent mode's missing links. |
| `related-hops-2` | 290, one per site | Holdout, measured once per release. `results.json` holds the published numbers. |

**How they were built** (October 2026, `src/cli/related-hops-build.ts`):

1. Start pages: English article and listing URLs from Common Crawl — CC-NEWS (2026/09 for
   `related-hops`, 2026/08 for `related-hops-2`) and `CC-MAIN-2026-34` — rendered live. Sites of
   WebWalkerQA, sites agent mode's role models were trained on and, for `related-hops-2`, the sites
   of the first batch are excluded.
2. Claude Sonnet 5.5 chose the link from the page's list of links and wrote the question and
   answer from the target page.
3. A second model checked every task — gpt-6.1-sol for `related-hops`, Claude Opus 5.5 for
   `related-hops-2` — and a task was kept only when the target page supports the answer and the
   start page does not answer the question.
4. Tasks about private people were removed afterwards.

**Fields:** `id`, `site` (the start page's site after redirects), `pageUrl`, `targetHref`,
`target` (normalized), `label` (the link's text), `category`, `question`, `answer`, `capturedAt`
(when the two pages were rendered).

The questions and answers were written and checked by models, not by people, and some may be
wrong. The pages change or disappear; `related-hops:build --stage=fetch` renders them again.

**License:** the task lists are Apache-2.0, like the repository. The linked pages belong to their
owners and none of their content is included. To have a task removed, open an issue.
