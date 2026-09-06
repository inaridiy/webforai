# Project quality review and improvements

## Goal and acceptance

Review the entire project and implement evidence-backed improvements to platform API stability, dashboard usability, library conversion accuracy/performance, and agent-facing CLI reliability. Preserve the library/platform dependency boundary and Cloudflare production model. No deployment or external messaging is required.

Start revision: `9dd0fe2`. The user's untracked `screen-shot.png` is preserved.

## Progress

- [x] (2026-09-06) Review the four areas and establish concrete defects and regression criteria.
- [x] (2026-09-06) Improve library conversion and CLI behavior, with regressions and documentation.
- [ ] Improve platform API and dashboard behavior, with regressions and documentation.
- [ ] Validate the integrated change, review design drift, and record remaining limitations.

Each completed step ends in a conventional commit, staging explicit paths only.

## Ownership and work sequence

All lanes share `/home/inaridiy/webforai`; only the coordinator commits, runs broad formatters, builds, and final integrated checks. Review/implementation lanes own disjoint source paths: library owns `packages/webforai/src` excluding `cli/**` and `platform/**`; CLI owns `cli/**` and `platform/**`; API owns platform server source excluding `client/**`. Coordinator owns dashboard, documentation, plan, and integration. Agents report README/spec changes for coordinator integration rather than editing shared documentation.

First inspect code and tests, then select bounded fixes with reproducible consequences. Avoid speculative rewrites, new dependency installation, and performance claims without measurements. Existing styles/components remain the UI foundation.

## Validation

Targeted regressions per change; integrated `pnpm run test --run`, `pnpm typecheck`, `pnpm build`, `pnpm --filter platform typecheck`, `pnpm --filter platform test`, and `pnpm --filter platform build`. Run formatting/lint before commits, inspecting noise rather than ignoring it. Browser validation of affected dashboard states if the available local runtime supports it. Review `docs/specs/platform` and update changed README flows in the same milestone.

## Surprises & discoveries

- Conversion globally stripped literal `****`, rewrote code examples as links, lost leading code indentation/language, removed sole math fallbacks, and mutated unowned HAST. Browser loaders captured stale HTML or leaked resources on errors; splitter cancellation and branch-local priorities were broken.
- CLI interactive mode bypassed option normalization; numbered output collision handling could loop forever. SDK polling deadlines did not cover a pending HTTP request/body.
- Dashboard jobs hid failures as empty state, response-body failures escaped Result, request races could overwrite fresh data, and mobile navigation overflowed. Copy feedback survived replacing a revealed key.
- Workflow creation could undo `running` with a late `queued` write. Retried pages incremented counters and inserted randomly identified usage again. This required durable idempotency rather than another retry wrapper.
- Independent review found and closed additional scheduling-response ambiguity, inaccessible billed pages after KV publication exhaustion, and concurrent full-archive memory pressure. Canonical result reads now hydrate one document at a time.
- Root Vitest includes platform unit tests; live provider E2E is separate. Validation noise is recorded once in `.agents/known-issues.md`, including resolved runner/HMR issues.

## Decision log

- 2026-09-06: Add generated `job_pages` migration for atomic page identity/counters/usage; immutable R2 archive precedes D1, KV is a projection, authenticated reads use canonical data. Drain historical in-flight jobs before migration/deployment. See updated platform architecture/billing specs and README rollout.
- 2026-09-06: Preserve scheduler uncertainty rather than falsely promise no side effects; monotonic D1 predicates prevent late queued rewrites.
- 2026-09-06: Defer the preview renderer with a local error boundary so dashboard startup avoids its JS and raw output survives chunk failure. Use existing Tailwind/UI inventory.
- 2026-09-06: CI now uses pinned installed browser CLIs, Node 24, platform typecheck/build, D1 accounting and browser checks. Unit test configs use forks to eliminate observed Node 24 thread shutdown crashes; root config is ESM.

- 2026-09-06: Use independent bounded review/implementation lanes because local AGENTS.md explicitly requires delegation of parallelizable reviews. Coordinate shared build outputs and commits centrally.

## Outcomes & retrospective

Implementation and integration are in progress; evidence collected so far:

- Library source regression suite: 125 tests; real Chromium for local browser loaders, mocked Cloudflare transport. CLI/SDK focused checks included a real loopback HTTP 429 CLI invocation and cancellation of an incomplete HTTP response body.
- Integrated `pnpm run test --run`: 38 files, 446 tests passed, exit 0. `pnpm --filter platform test`: 17 files, 193 tests passed, exit 0. Root/platform typechecks and sherif passed.
- Production Drizzle repositories on disposable workerd D1: generated migrations, simultaneous conflicting commits, one usage event, unbilled failure, forced final-statement rollback and retry, owner guard, batch/crawl totals, monotonic queued/running state, numeric page order, cursor and expiry. Command: `pnpm --filter platform test:integration`. No developer D1 state was used.
- Actual browser fixture journey: 1440/390 px dashboard geometry and screenshots, job failure/retry, malformed JSON, authentication outage/retry, key copy failures and replacement, lazy preview request/render, hook stale replies/rejections/unmount/save invalidation. Command: `pnpm --filter platform test:browser`. HTTP auth/data is explicitly stubbed, not evidence of real auth or cloud services.
- Library build and platform build passed. Platform build's self-extraction gate produced 3909 Markdown body characters. Preview splitting reduces initial JS from 857.87 kB to 354.39 kB (gzip 258.51 to 108.74 kB); no field performance/Core Web Vitals claim.
- Frozen benchmark: actual base `9dd0fe2` vs current library source, 60 cached captures / 24.17 MiB, seven alternating paired passes. Median 2938.8→2862.2 ms (approximately unchanged speed); 0 conversion errors and 88/88 existing quality assertions on both, 28 changed outputs. Raw protocol, hashes and results: `evals/.reports/2026-09-06-quality-review/`. One missing StackOverflow capture; no semantic precision/recall or memory benchmark.

### Review follow-ups deliberately left open

Owner for each: repository maintainers. Reopen in a scoped task when the relevant product contract is set; these are not claims that the entire project is defect-free.

- Stripe meter reconciliation beyond its guaranteed deduplication window: local D1 uniqueness does not guarantee unbounded external exactly-once billing after a lost Stripe acknowledgement. Requires durable send/reconciliation policy and provider verification.
- Scheduling unknown: if both creation and status lookup fail, preserve the job id and return 503; operators must reconcile the Workflow before resubmitting. No staleness recovery service was added.
- Local fetch loader still lacks a configured deadline/status policy; decide whether error-page HTML conversion is intentional before changing its public behavior.
- Standalone `pipeExtractors` custom identity extractor ownership propagation, total table-grid resource budget, and repeated subtree scans in math normalization remain narrower library review leads. `htmlToMdast` now protects unowned input at its own boundary.
- SDK successful payload validation remains primarily structural TypeScript typing; dashboard's runtime validation does not imply SDK validation.
- Full deployed Workflows/Stripe/proxy/Browser Run journey and real authenticated dashboard E2E were not run. Cloudflare transport unit tests are mocked; no production migration or deployment was performed. Existing live E2E screenshot rejection fixture now explicitly selects fetch, matching the auto-engine default.
- Storybook is not installed. Used a reproducible browser fixture harness for the actual composed dashboard and async hook instead of adding a new dependency stack. Browser tests are now wired into CI; hosted CI itself has not run in this session.

### Retained resources

- User-owned untracked `screen-shot.png` preserved.
- Ignored benchmark artifacts and dashboard screenshots retained for inspection. Owned benchmark source snapshots under `/tmp/webforai-quality-benchmark-sytsdioo` were removed after acceptance; lifecycle recorded in the report. All test servers and disposable D1 runtime are closed by finally/teardown.

