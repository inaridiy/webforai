# Agent mode on WebWalkerQA: are the next links kept, and at what size?

Owner request (2026-10-09): measure whether agent mode is worth it when the output is given to an
AI agent, starting with the cheapest decisive experiment (design A of the benchmark discussion):
no LLM, only whether the link an agent must follow next survives conversion, against output size.
Stacked on `feat/comments-mode-compact-tables`. Not pushed until the owner decides.

## Design

- **Data**: WebWalkerQA `main` (Wu et al., arXiv:2501.07572, Apache-2.0), English tasks (`lang` en
  or empty: 305 of 680). Each task has a root URL, the answer page(s) and a golden path of link
  labels. Mind2Web was rejected: its HTML snapshots carry no `href`, and its gold actions are
  mostly form widgets.
- **Hops** (`webwalker:fetch`): each golden path is followed on the live site in headless
  Chromium; labels match anchors by whitespace-free, case-folded text (exact, else containment);
  up to 3 candidate URLs are tried; a page that links to the source page directly ends the path.
  Pages are cached (rendered DOM), never committed. Paths that do not resolve (site changes since
  the dataset, bot blocks, labels that are buttons) are dropped and counted.
- **Score** (`webwalker:links`): every clicked page is converted by each pipeline; a hop is kept
  when the output links to its target (`normalizeUrl`: scheme, `www.`, fragment, trailing slash
  ignored). Size: o200k_base tokens per page (`python/count_tokens.py`, tiktoken 0.9.0).
- **Pipelines**: webforai readability and agent; **webforai + all links** (readability output, then
  every other link of the page — the baseline agent mode must beat); Readability + Turndown;
  Defuddle; Trafilatura with `include_links=True`; full-page Turndown and node-html-markdown.
  Firecrawl OSS and Cloudflare toMarkdown are services and are not run on these pages.
- **Reading**: "hops kept, not in content" restricts to hops whose link the readability output
  lacks — the only hops where agent mode can add anything.

## Progress

- [x] (2026-10-09) Fetch and resolve hops: 305 English tasks, 435 golden paths, 208 resolved (150
      tasks, 249 distinct hops on 103 pages). Unresolved: 125 source page no longer linked from
      the last page (site changes), 77 label not found, 25 fetch errors (bot blocks, timeouts).
- [x] (2026-10-09) Score; results below.
- [ ] Owner decision: build design B (single-step LLM choice) or improve roles first.

## Results (webforai at the base branch's build, 2026-10-09)

159 of the 249 hops are links the readability output does not contain ("nav hops").

| Pipeline | Hops kept | Nav hops kept | Paths fully kept | Median / mean tokens per page |
| --- | ---: | ---: | ---: | ---: |
| webforai (readability) | 36.1% | 0.0% | 16.3% | 973 / 1,582 |
| webforai (agent) | 79.1% | 67.3% | 64.9% | 2,616 / 2,933 |
| webforai + all links | 100% | 100% | 100% | 3,071 / 3,704 |
| Readability + Turndown | 15.7% | 9.4% | 6.7% | 463 / 934 |
| Defuddle | 45.0% | 22.6% | 20.7% | 1,353 / 4,577 |
| Trafilatura (include_links) | 19.7% | 4.4% | 12.0% | 482 / 711 |
| Turndown (full page) | 81.1% | 91.8% | 79.3% | 3,697 / 5,122 |
| node-html-markdown (full page) | 94.0% | 96.2% | 91.3% | 3,546 / 4,619 |

- **Agent mode does not beat "readability + all links" here.** It drops 21% of the hops to save
  15% of the median tokens (21% of the mean). The pitch "full-page reach at reader-mode cost" does
  not hold on this data: agent output is 2.7× the readability output's median size.
- Agent mode's nav hops kept, by section: Site navigation 72, Related 18, Section navigation 13,
  Pagination 4; missing 52.
- **The 52 misses**: 30 are in blocks the role models assign no role (dropped as boilerplate);
  22 are removed before scoring (header dropdown menus on sigchi.org, the mobile menu on
  rovio.com, …), so no role model sees them.
- Reader-mode competitors keep few next links even with links on; full-page converters keep most
  at the highest size.
- Caveats: WebWalkerQA paths are mostly site menus (as expected, little related/pagination);
  150 tasks on ~40 sites, so sites with many hops (sigchi, poms, vldb) weigh heavily; "all links"
  is 100% by construction, since hops were resolved from the same anchors.

## Decision log

- (2026-10-09) Pages are rendered: several sites build their menus in JavaScript (static fetch
  found 0–1 links on them). No layout annotation is added, so every pipeline sees the same DOM.
- (2026-10-09) WebWalkerQA is used as a holdout for agent mode: the role models are not tuned on it.
- (2026-10-09) Next step is the owner's: whether the roles are worth their recall cost can only
  show in design B (an LLM choosing the next link from grouped vs flat lists), or after keeping
  menu links that are removed before scoring and lowering the "no role" drop.
