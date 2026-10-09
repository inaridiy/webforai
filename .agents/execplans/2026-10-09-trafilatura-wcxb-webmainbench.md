# Trafilatura, WCXB and WebMainBench in the evaluation harness

Owner request (2026-10-09), while reviewing PR #85: measure Trafilatura, and make webforai
measurable on WebMainBench or WCXB, before the README claims the highest accuracy. Stacked on
#85 (`docs/readme-benchmarks`).

## Progress

- [x] (2026-10-09) Trafilatura as a cached pipeline: `python/trafilatura_worker.py` (PEP 723,
      trafilatura 2.3.1 pinned, run with `uv run --script`), runner `trafilatura`, cache
      `.cache/trafilatura`, competitor `trafilatura` (`extracts: true`, `serviceMs` = Python time).
      Corpus (60, timed, 5 rounds) and WCEB (3,985): 0 failures.
- [x] (2026-10-09) WCXB v1.0 (`gold:fetch-wcxb`, sets `wcxb-test` / `wcxb-dev`, grouped by page
      type, scored with its own `\w+` tokenizer) and WebMainBench (`gold:fetch-webmainbench`, set
      `webmainbench`, grouped by level). `gold:eval -- --save-outputs` and
      `gold:rouge-webmainbench` (MinerU-HTML's ROUGE-5 over jieba tokens, copied, Apache-2.0).
- [x] (2026-10-09) First measurement of the holdouts (results below).
- [ ] Owner decision: what the README and `/benchmarks` claim given these results (PR #85).

## Results (webforai at 2367b42 + dd14f61, Trafilatura 2.3.1, 2026-10-09)

WCEB, token F1 (3,985 pages; mean over pages / over the 8 datasets):

| Pipeline | pages | datasets | P / R |
| --- | ---: | ---: | ---: |
| Trafilatura | **0.900** | 0.902 | 0.916 / 0.915 |
| webforai | 0.892 | **0.909** | 0.922 / 0.909 |
| Readability + Turndown | 0.880 | 0.901 | 0.917 / 0.892 |

Paired bootstrap (2,000, stratified by dataset), webforai − Trafilatura: pages −0.008
[−0.014, −0.003], datasets +0.007 [+0.001, +0.013]. Trafilatura leads on Dragnet (0.901 against
0.848; 1,379 pages whose references include reader comments, which Trafilatura keeps by default),
Scrapinghub and CETD; webforai on the other five.

WCXB test, its tokenizer (511 pages): webforai 0.875, Trafilatura 0.860, Defuddle 0.855,
Readability + Turndown 0.831. webforai − Trafilatura +0.015 [−0.003, +0.032] (not significant);
− Defuddle +0.020 [+0.004, +0.037]; − Readability +0.044 [+0.023, +0.064]. Published (paper,
Table 5): rs-trafilatura 0.903 (tuned on dev), Trafilatura 0.841, Readability 0.736. WCXB dev
(1,497): webforai 0.831, Trafilatura 0.817.

WebMainBench (7,809 pages):

| Pipeline | token F1 | ROUGE-5 (all / simple / mid / hard) | ROUGE P / R |
| --- | ---: | ---: | ---: |
| webforai | **0.861** | 0.585 / 0.707 / 0.579 / 0.468 | 0.537 / 0.752 |
| webforai, links as text, no images | 0.864 | 0.668 / 0.770 / 0.668 / 0.566 | 0.650 / 0.764 |
| Trafilatura | 0.814 | **0.673** / 0.757 / 0.681 / 0.577 | 0.699 / 0.695 |

Published ROUGE-5 (Dripper, Table 2): Readability (readability-lxml, Html+MD) 0.654,
Trafilatura Html+MD 0.640, Trafilatura MD 0.628; Dripper 0.878, its LLM variants up to 0.910.

Corpus time (60 captures): Trafilatura 2.94 s in Python (5 rounds, alone, load ≈ 5) against
webforai 3.95 s in the 2367b42 `bench:compare` run (load ≈ 3): not measured together.

## Decision log

- (2026-10-09) Trafilatura runs with its defaults and Markdown output, as its documentation shows
  (`include_comments` and `include_tables` on, links and images off). Not tuned per benchmark.
- (2026-10-09) The worker is fed by Node so the cache key is the same SHA-256 of the JavaScript
  string every other cached pipeline uses.
- (2026-10-09) WCXB is scored on `markdownToPlain(output)` with its tokenizer. Its `evaluate.py`
  scores the raw prediction; link URLs in Markdown would otherwise count as words.
- (2026-10-09) WebMainBench's HTML is passed unchanged, annotations included, as its baselines
  receive it. The token F1 compares `markdownToPlain` of both sides; ROUGE-5 compares raw Markdown
  like the paper's MD mode, so it also measures formatting (link URLs, image syntax, bullet
  style). Hence the links-as-text variant (`webforai-nolinks` in `gold:eval`).
- (2026-10-09) The 545-page fine-grained metrics are not implemented: their formula filter calls
  an LLM by default and their TEDS reduces to a near-constant (apted is given strings).
- (2026-10-09) `wcxb-test` and `webmainbench` are holdouts: measured per release, never iterated
  against.
