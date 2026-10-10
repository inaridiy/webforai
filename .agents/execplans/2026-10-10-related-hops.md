# related-hops: a next-link set for related articles, read-next, sequences and pagination

Owner request (2026-10-10): build a dataset where the link to follow is a related article, a
"read next", the next/previous article, a series part or the next page of a listing — the roles
WebWalkerQA's site-menu paths hardly test (its gold links were 84 site navigation, 41 related, 24
section navigation, 7 pagination of 159 non-content hops). Stacked on `feat/agent-recall`; not
pushed.

**This set is the holdout for agent mode.** Measure it once per release; never tune thresholds,
rules or models against it, and do not inspect individual misses to fix them (WebWalkerQA lost its
holdout status that way).

## Design

- **Start pages (P0)**: English article and listing URLs from Common Crawl — CC-NEWS (September
  2026) and blog/news/docs-style paths of `CC-MAIN-2026-34` — at most 4 per site, sites ordered
  round-robin in a hashed order. Host-disjoint from the data agent mode's models were trained on
  (`--exclude-hosts`, a host list kept outside the repository) and from every WebWalkerQA site
  (main and silver).
- **Pages**: rendered live through the proxy pool (`live-pages.ts`), one request at a time per
  host. English check: `lang` (when present) and the text (English function words, Latin script).
- **Gold link, converter-independent**: Sonnet 5.5 (`claude -p`) labels P0's anchor list (text,
  URL, nearest enclosing elements) with related / read_next / prev_next_article / series /
  next_page, excluding running text, global menus, tags, authors, sponsored rails, share, legal and
  other sites. One same-site link is drawn per page (seeded by the URL), steering towards 60%
  related (related, read_next) and 40% sequence (prev_next_article, series, next_page).
- **Question**: Sonnet 5.5 writes a question answered by one checkable fact of P1, naming P1's
  subject in its own words (not its title, never a URL), with a verbatim supporting quote.
- **Verification**: gpt-6.1-sol (`codex exec`, low effort), independently, reads the question, the
  answer, P0's full visible text and P1's text; the task is kept only if P1 supports the answer and
  P0 (teasers and link texts included) does not answer the question.
- **Freeze**: `evals/.cache/related-hops/tasks.jsonl` and `hops.jsonl` (≤3 tasks per site),
  `summary.json` with drop reasons. Page HTML stays in the cache.
- **Scoring**: `webwalker:links -- --set=related-hops` (A) and `webwalker:choose --
  --set=related-hops` (B), unchanged from WebWalkerQA.

## Progress

- [x] (2026-10-10) `--set=` for the WebWalker scoring; rendered, proxied fetching moved to
      `live-pages.ts` (`83da86e`).
- [x] (2026-10-10) Builder `related-hops:build` (`5d19385`).
- [x] (2026-10-10) Built and frozen: **285 tasks on 283 sites** (phase 1: 900 start candidates,
      one per site; a second batch of 600 was started and stopped unverified, to spare the shared
      codex quota — its pages sit in `.cache/related-hops/unused/`).
- [ ] Baseline (agent before E3): A and B.

## Counts (frozen 2026-10-10)

- Sources: 5,897 candidates on 3,458 sites (CC-NEWS 3,240, CC-MAIN 2,657) after excluding 7,252
  sites; 900 start pages tried.
- Categories: related 179, read_next 2 (related group 181, 64%); prev_next_article 102, next_page
  1, series 1 (sequence group 104, 36%). Next-page and series links were rare on start pages drawn
  from news and blog article URLs.
- Dropped: start not English 242, no same-site related or sequence link 183, start fetch failed
  57, label not English 47, too few links 28, no checkable fact on the target 20, answerable from
  the start page 20, per-site cap 8, target HTTP error 4, target not English or same page 4,
  target fetch failed 2.
- Files: `evals/.cache/related-hops/tasks.jsonl`, `hops.jsonl`, `summary.json` (gitignored).

## Results

### Baseline A (agent before E3: `feat/agent-recall` at 4c35e62)

| Pipeline | Hops kept | Kept, not in content | Median / mean tokens |
| --- | ---: | ---: | ---: |
| webforai (readability) | 8.4% | 0.0% | 1,047 / 1,436 |
| webforai (agent) | 81.8% | 80.1% | 2,213 / 2,772 |
| webforai (agent, no role headings) | 81.8% | 80.1% | 2,202 / 2,764 |
| webforai + all links | 100% | 100% | 3,167 / 3,728 |
| Readability + Turndown | 8.1% | 5.0% | 962 / 1,327 |
| Defuddle | 9.8% | 6.1% | 969 / 1,619 |
| Trafilatura (include_links) | 4.2% | 2.3% | 777 / 1,221 |
| Turndown (full page) | 99.6% | 100% | 4,831 / 6,899 |
| node-html-markdown (full page) | 97.2% | 96.9% | 4,369 / 6,036 |

Where agent mode put the gold link: related group (181) — Related 108, Site navigation 39,
content 17, missing 17 (kept 90.6%); sequence group (104) — Pagination 46, Related 13, content 7,
Site navigation 3, missing 35 (kept 66.3%). Agent output is 70% of the all-links size here (news
and blog pages carry far more boilerplate links than WebWalkerQA's sites), but it drops a third of
the previous/next-article links.

## Decision log

- (2026-10-10) Gold links come from an LLM reading the anchor list with DOM context, not from any
  converter's output, so the set does not favour the pipeline that found them.
- (2026-10-10) Same-site gold links only: cross-site "related" rails are mostly advertising.
- (2026-10-10) The question must not be answerable from P0's full text, teasers included; a model
  that could answer without following the link would make B measure reading, not navigation.
