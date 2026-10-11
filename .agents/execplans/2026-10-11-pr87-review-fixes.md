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

- [ ] Library and CLI: hidden-menu links filtered, share filter on resolved URLs, `keepScale`
      validated, links deduplicated by resolved URL, packaging nits; tests.
- [ ] Evals: host exclusion after redirects, `--set` handling, silver hosts, choice cache keyed by
      output, failures counted, Trafilatura cache and timing records, live fetch without
      rotation on 403/429, CLI isolation; related-hops-2 without the shared site and the tasks
      naming private people; datasheet; evals README.
- [ ] Docs: README, package READMEs, landing and benchmarks pages, chart footnote.
- [ ] Agent-mode numbers re-measured on the final code; docs updated.
- [ ] Checks: format, lint, typecheck, tests, build, site build.

## Decision log

- (2026-10-11) Work on a separate branch: `release/v5` is checked out in another worktree.
