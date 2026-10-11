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
      `live-pages.ts` (`fc2980d`).
- [x] (2026-10-10) Builder `related-hops:build` (`34f50d3`).
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

## Status change (2026-10-10): this set is now dev for agent mode

Measuring the E3 agent (role models retrained, keep model) once: hops kept 81.8%, unchanged from
the pre-E3 baseline; Haiku ×2 agent 75.8 vs all links 91.1 (−15.3 [−20.3, −10.8]). Counting the
misses by cause, then tracing them, showed 50 of the 52 on pages a site adapter claims (58 of 285
pages, WordPress above all): agent mode returned the adapter's output with no link sections at
all. The fix (agent mode keeps the adapter's content and still lists the page's links) was then
confirmed on pages outside this set before shipping, but it came from inspecting this set, so **related-hops is a development set from here on**, like
WebWalkerQA. A clean holdout needs a second batch on fresh hosts built with the same builder.

## As a dev set (2026-10-10)

After the adapter fix (agent mode lists links on site-adapter pages; `3cd99ad`):

| Pipeline | Hops kept | Median tokens | Haiku ×3 | Sonnet ×3 |
| --- | ---: | ---: | ---: | ---: |
| agent | 99.3% | 2,567 | 92.0 | 93.6 |
| agent, same-site links as paths | 99.3% | 2,228 | 91.2 | 92.9 |
| all links | 100% | 3,167 | 91.3 | 93.8 |
| Turndown (full page) | 99.6% | 4,831 | 92.6 | 93.9 |
| node-html-markdown (full page) | 97.2% | 4,369 | 89.9 | 92.5 |
| readability | 8.4% | 1,047 | 8.4 | 8.4 |

Agent − all links +0.7 [−1.2, +2.6] / −0.2 [−1.9, +1.5]; agent − node-html-markdown +2.1 / +1.1
(n.s.); paths − agent −0.8 / −0.7 (n.s.). Agent output is 19% smaller than all links and ~45%
smaller than full-page conversion at the same accuracy. Same-site paths save another 13% of
tokens but are not shipped: no gain in accuracy, and an agent must resolve them.

Learning from this set: Sonnet's per-link labels of the 350 start pages with related or sequence
links, added as related/pagination training rows for the role models, did not help on held-out
pages; not used. Raising the keep threshold ×1.5–3 saves
under 3% of tokens here and on WebWalkerQA while recall falls fast; the threshold stays.

A clean holdout is being built as `related-hops-2` (fresh hosts: CC-NEWS 2026/08, other WARC
files, every host of this batch and of the role models' training data excluded; Opus 5.5
verifies instead of codex).

## related-hops-2: the holdout (frozen 2026-10-10, before any measurement)

295 tasks on 293 sites (related 204, previous/next article 86, read next 3, series 2), built with
the same builder from CC-NEWS 2026/08 and other main-crawl WARC files (`--warc-offset=7`), with
every host of related-hops' candidates and of the role models' training data excluded (10,710
sites) and WebWalkerQA's sites excluded by the builder; checked: 0 hosts shared with related-hops,
the training data or WebWalkerQA.
Questions verified by Opus 5.5 (`--verifier=opus`; codex was at 44% of its weekly quota); 28 of
344 questions had no verdict after two passes (CLI errors) and are not in the set. Dropped: 279 not
English, 154 no same-site related or sequence link, 60 fetch failures, 46 too few links, 28 no
checkable fact, 16 answerable from the start page, 19 target or freeze rules.

It is measured once, with the agent of `feat/agent-recall` at `de4b772`+ (adapter fix included),
and not inspected beyond the aggregate tables.

### related-hops-2 results (measured once, 2026-10-10/11)

| Pipeline | Hops kept | Median tokens | Haiku ×3 | Sonnet ×3 |
| --- | ---: | ---: | ---: | ---: |
| **webforai agent** | 99.7% | **2,440** | **93.0** | **95.0** |
| agent, no role headings | 99.7% | 2,426 | 93.4 | 94.5 |
| agent, same-site links as paths | 99.7% | 2,203 | 94.0 | 95.6 |
| webforai + all links | 100% | 2,902 | 92.4 | 94.5 |
| Turndown (full page) | 99.7% | 4,533 | 93.0 | 94.9 |
| node-html-markdown (full page) | — | 4,350 | 92.8 | 94.6 |
| Defuddle | — | 1,075 | 11.3 | 11.5 |
| Readability + Turndown | — | 967 | 6.8 | 7.1 |
| Trafilatura (include_links) | — | 893 | 5.6 | 5.4 |
| webforai readability | 7.1% | 1,069 | 6.9 | 7.1 |

Paired, 95% CI over sites (Haiku / Sonnet): agent − all links +0.6 [−1.1, +2.4] / +0.6 [−0.6, +1.8];
agent − node-html-markdown +0.2 [−1.6, +2.1] / +0.5 [−0.9, +1.9]; role headings −0.5 / +0.6;
same-site paths − agent +1.0 [−0.3, +2.4] / +0.6 [−0.3, +1.7] (all n.s.); agent − readability +86 / +88.

On fresh hosts agent mode chooses the next related or sequence link as well as listing every link
or converting the whole page, with 16% fewer tokens than all links and ~45% fewer than full-page
conversion. Reader-mode converters (Readability, Defuddle, Trafilatura even with links) cannot do
this task (5–12%).

### Publication (2026-10-11)

Both task lists are committed as `evals/benchmarks/related-hops{,-2}/tasks.jsonl`: URLs, the gold
link, the question and the answer. Page HTML is not (third-party content, as for the rest of the
evals); `--stage=fetch` renders the start pages again, so a rerun scores against today's pages.
The host exclusion list is not published. README and `/benchmarks` report related-hops-2.

## Decision log

- (2026-10-10) Gold links come from an LLM reading the anchor list with DOM context, not from any
  converter's output, so the set does not favour the pipeline that found them.
- (2026-10-10) Same-site gold links only: cross-site "related" rails are mostly advertising.
- (2026-10-10) The question must not be answerable from P0's full text, teasers included; a model
  that could answer without following the link would make B measure reading, not navigation.
- (2026-10-11) Publish the task lists, not the pages: the claim must be checkable, and the
  holdout keeps its use (measured once per release) whether or not it is public — no model is
  trained on it.
- (2026-10-11) Review of PR #87: the host exclusions were applied before redirects, so three
  related-hops-2 tasks came from a site of the first batch (six expired domains redirecting to one
  site). They are dropped, and the builder now checks the site after redirects too. Tasks about
  private people (victims, minors, wedding couples, a student) and one adult-content task are
  dropped as well: related-hops-2 loses 5 tasks (290 left, on 290 sites), related-hops 6 (279).
  related-hops-2 is scored again from the cached outputs and answers of the remaining tasks — a
  subset, not a new measurement; the numbers are in `evals/benchmarks/related-hops-2/results.json`.
