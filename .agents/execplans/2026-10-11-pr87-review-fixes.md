# PR #87 review fixes

Owner request (2026-10-11): apply the review of PR #87 (`release/v5`). Branch `fix/pr87-review`
off `release/v5`, worktree `~/worktrees/webforai-pr87-fixes`; eval caches copied there
(`evals/.cache/gold` is a symlink to the main checkout's).

Owner's direction for the docs: the README states results plainly and leaves method detail to the
benchmarks page — no chain of caveats. Claim the WCEB lead over Trafilatura (both keeping reader
comments); drop the speed claim from the opening; drop small absolute claims nobody weighs (such
as "no shared host"). Fix factual errors (site adapter count). Medium findings are optional, Low
findings and every library and evals finding are to be fixed.

## Progress

- [x] (2026-10-11) Library and CLI (`9fea7c3`, `6673cb4`): hidden-menu links only from
      link-dense menus outside consent banners, without account/shop/legal links, at most 200;
      share filter on resolved URLs; `keepScale` validated, default 1 for every model; links
      deduplicated by resolved URL; only http(s) and relative links; packaging nits. Dev sets
      (cached, no model calls): WebWalkerQA 98.8% → 98.8% of hops kept, median 2,871 → 2,871
      tokens; related-hops 99.3% → 99.3%, 2,567 → 2,495.
- [x] (2026-10-11) Evals (`0402f1b`…`4084852`): host exclusion after redirects, `--set`
      handling, silver hosts required, answer cache keyed by prompt, failed calls counted,
      Trafilatura cache and timing records, no retries past 403/429, isolated model CLIs,
      `gold:eval --compare`; related-hops-2 290 tasks (3 on a site shared through redirects, 2
      about private people removed), related-hops 279 (6 about private people); datasheet;
      evals README. The WCEB intervals reproduce from the saved per-page results.
- [x] (2026-10-11) Docs (`2f76a26`, and `npx webforai-cli` without `@latest`).
- [x] (2026-10-11) kiwame, the confidence model and the role models retrained on Codex labels
      (`0cce96c`; θ re-selected and kept at 0.5, other settings unchanged) and kiwame cuts at
      page-end wording the models dropped (`a90c29a`). Against `b925b25`: WCEB default 0.892 →
      0.891 (−0.001 [−0.002, +0.000]), `comments` 0.922 → 0.923 (+0.001 [+0.000, +0.003]);
      corpus checks, code blocks and tables unchanged, empty outputs 4 → 2; stress clean; links
      kept unchanged on all three link sets.
- [x] (2026-10-11) Agent-mode numbers re-measured at `a90c29a` (related-hops-2 link choice for
      the four webforai rows, 3,528 calls; competitors' outputs unchanged) and the docs updated.
- [x] (2026-10-11) Checks at `6ebe9c7`: format, lint, lint:repo, typecheck, build, site build;
      tests 920 pass, 3 fail (the Playwright loader tests that need a local Chromium); platform
      typecheck, tests (505) and build.

## Decision log

- (2026-10-11) Work on a separate branch: `release/v5` is checked out in another worktree.
- (2026-10-11) Links that kiwame keeps as content but a site adapter drops stay unlisted: listing
  them added about 63 author, date and comment-count links on the related-hops dev set and
  recovered no hop.
- (2026-10-11) A dialog/modal rule for hidden links was tried and dropped: it removed a real
  mobile drawer (`role="dialog"`) on WebWalkerQA.
- (2026-10-11) Owner decision: v5 ships retrained kiwame, confidence and role models. The new
  weights are measured against the current ones on WCEB and the corpus before the docs change.
- (2026-10-11) A dropped terminator cuts only for page-end wording ("Powered by", feedback
  widgets, last-updated lines). With every terminator, 11 WCEB pages changed (net zero): dropped
  "Related posts" boxes and "Comments" headings set inside articles cut real text.
- (2026-10-11) The corpus table stays the 2026-10-09 run (`297b7df`); the retrained models leave
  its checks, code blocks and tables unchanged, and timing it again under load would only add noise.
- (2026-10-11) The related-hops-2 re-measure ran on the owner's subscription. The `claude` CLI
  updated itself twice during the run; the 37 calls that failed then were asked again, and the
  model CLIs now run with `DISABLE_AUTOUPDATER=1`. `webwalker:choose` gained `--pipelines` and
  `--dry-run` so that only the rows the docs report were asked.
- (2026-10-11) Owner decision: "Readability mode" becomes reader mode, and the `readability` preset
  and `readabilityExtractor` are renamed `reader` / `readerExtractor` with no alias. The old name
  suggested Mozilla's Readability, which the benchmarks list as a competitor. The worker example's
  own `mode=readability` becomes `mode=default`, as in the CLI's `--mode`.
