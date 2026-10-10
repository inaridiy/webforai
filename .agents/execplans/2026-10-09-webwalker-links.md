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
- [x] (2026-10-09) Owner decision: run design B (single-step LLM choice) generously, through the
      subscription CLIs rather than the API.
- [x] (2026-10-09) Design B: 276 items × 9 pipelines; Haiku 5.5 ×3, Sonnet 5.5 ×3 (`claude -p`),
      gpt-6.1-sol ×1 (`codex exec`, weekly quota 0% → 9%): 17,388 answers. Results below.
- [x] (2026-10-10) Fable review: WebWalkerQA is not training data (39 sites, half the hops on root
      pages); it decides operating points and finds rule bugs. English WebWalkerQA is demoted to
      dev for agent mode, since its misses were inspected. Changes on `feat/agent-recall`.
- [x] (2026-10-10) A and B re-run after `feat/agent-recall` (results below).

## Results (webforai at the base branch's build, 2026-10-09)

159 of the 249 hops are links the readability output does not contain ("nav hops").

| Pipeline | Hops kept | Nav hops kept | Paths fully kept | Median / mean tokens per page |
| --- | ---: | ---: | ---: | ---: |
| webforai (readability) | 36.1% | 0.0% | 16.3% | 973 / 1,582 |
| webforai (agent) | 79.1% | 67.3% | 64.9% | 2,616 / 2,933 |
| webforai + all links | 100% | 100% | 100% | 3,071 / 3,704 |
| Readability + Turndown | 19.3% | 9.4% | 6.7% | 463 / 934 |
| Defuddle | 45.4% | 22.6% | 20.7% | 1,353 / 4,577 |
| Trafilatura (include_links) | 19.7% | 4.4% | 12.0% | 482 / 711 |
| Turndown (full page) | 92.4% | 98.7% | 90.9% | 3,697 / 5,122 |
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

## Design B: next-link choice (`webwalker:choose`)

- Items: one per task and page on a resolved path (276). The model gets the task's question, the
  page URL and one pipeline's output, and answers with one URL copied from the page (structured
  output). Correct: a next link of any of the task's golden paths on that page, or a source page;
  the URL must be a link in the output (no navigating from memory). Outputs without links are
  wrong without asking.
- Pipelines as in A, plus **agent without role headings** (same links and order, one flat list):
  agent − flat isolates what grouping by role adds; flat − all links what the link selection costs.
- Models through the local CLIs: Haiku 5.5 and Sonnet 5.5 via `claude -p` (no tools, fixed system
  prompt, 3 repetitions each), gpt-6.1-sol via `codex exec` (low effort, 1 repetition). Paired
  differences with a 95% CI bootstrapped over sites.
- Measurement fix found by the first B run: Turndown writes link text with blank lines inside the
  brackets, which CommonMark does not parse as a link; `markdownLinks` now also takes any
  `](url)`. Turndown (full page) hops kept 81.1% → 92.4%, Readability + Turndown 15.7% → 19.3%;
  the other rows are unchanged.

## Design B results (2026-10-09)

Accuracy in % (mean over repetitions); median o200k tokens of the page output.

| Pipeline | Haiku 5.5 | Sonnet 5.5 | gpt-6.1-sol | Tokens |
| --- | ---: | ---: | ---: | ---: |
| webforai (readability) | 30.2 | 31.0 | 31.5 | 973 |
| webforai (agent) | 55.1 | 56.0 | 60.1 | 2,135 |
| webforai (agent, no role headings) | 55.0 | 55.8 | 58.7 | 2,124 |
| webforai + all links | **64.4** | **66.4** | **70.7** | 2,908 |
| Readability + Turndown | 20.9 | 19.8 | 20.7 | 568 |
| Defuddle | 33.5 | 34.1 | 36.2 | 1,064 |
| Trafilatura (include_links) | 16.4 | 16.7 | 16.7 | 510 |
| Turndown (full page) | 61.6 | 62.2 | 65.9 | 3,661 |
| node-html-markdown (full page) | 62.8 | 62.0 | 67.4 | 3,364 |

Paired, 95% CI over sites: agent − all links −9.3 [−14.8, −4.6] (Haiku), −10.4 [−15.2, −6.4]
(Sonnet), −10.5 [−16.8, −5.3] (gpt); agent − no role headings +0.1 [−1.0, +1.2], +0.2 [−1.3, +2.2],
+1.4 [+0.3, +3.2]; agent − readability about +25 for every model.

Conditioned on the correct link being in the agent output, agent and all links are equally easy
to choose from (Haiku 71.0% / 69.6%, Sonnet 72.3% / 72.1%, gpt 77.6% / 76.2%); where agent dropped
it, all links still gets 46–52%. **The whole gap is recall.** Neither the link selection nor the
role grouping makes the choice easier for any of the three models; dropping links only costs.
Agent mode's value over readability (+25 points) is real; its value over listing every link is,
on this data, only ~27% fewer tokens.

## After `feat/agent-recall` (2026-10-10; WebWalkerQA is dev from here)

Misses traced to rules, not labels: card links (`<a href><div>…</div></a>`, never seen by
`blockLinks`), links in hidden menus (removed before role scoring), and near-threshold roles.
Fixed with card links in `blockLinks`, hidden navigation links listed under Site navigation,
`keepScale` 0.4 (a link is kept at 0.4× its role's threshold; role choice unchanged) and a share-URL
filter.

| | Hops kept | Mean tokens | Haiku | Sonnet | gpt-6.1-sol |
| --- | ---: | ---: | ---: | ---: | ---: |
| agent before | 79.1% | 2,933 | 55.1 | 56.0 | 60.1 |
| agent after | 98.8% | 3,344 | 63.9 | 64.3 | 67.8 |
| all links | 100% | 3,704 | 64.4 | 66.4 | 70.7 |
| node-html-markdown (full page) | 94.0% | 4,619 | 62.8 | 62.0 | 67.4 |

Agent − all links now −0.5 [−1.9, +0.8], −2.2 [−4.7, +0.0], −2.9 [−6.3, +0.0] (was −9 to −10.5);
agent − node-html-markdown +1.1, +2.3, +0.4 (n.s.); agent − readability +33 to +36. Agent output is
90% of the all-links size here (8% fewer median tokens): the conference and society sites of
WebWalkerQA carry few boilerplate links, so the token saving is small.

## Decision log

- (2026-10-09) Pages are rendered: several sites build their menus in JavaScript (static fetch
  found 0–1 links on them). No layout annotation is added, so every pipeline sees the same DOM.
- (2026-10-09) WebWalkerQA is used as a holdout for agent mode: the role models are not tuned on it.
- (2026-10-09) Next step is the owner's: whether the roles are worth their recall cost can only
  show in design B (an LLM choosing the next link from grouped vs flat lists), or after keeping
  menu links that are removed before scoring and lowering the "no role" drop.
