# Follow meta-refresh redirects; truncate the demo at a visible, safe boundary

Living document per `.agents/PLANS.md`. Follow-up to
`2026-08-24-auto-engine-and-landing-prerender.md` (auto engine, prerendered landing).

## Purpose / Big picture

Investigating "the member list of https://delight.sfc.wide.ad.jp/ja/ cannot be extracted"
found two stacked causes, neither in the extractor (the extractor output for `/ja/` is
complete — 24 members with portraits and links, verified against the live site with both
the workspace build and published webforai@3.0.0):

1. The site's **root URL answers HTTP 200 with a "Redirecting…" stub** (GitHub Pages):
   `<meta http-equiv="refresh" content="0; url=/ja/">` plus a JS language redirect.
   Browsers follow it; webforai's fetch loader and the platform's fetch-tier engines
   convert the stub — output: `"Redirecting… If not redirected, go to [/ja/](/ja/)."`.
   The platform's `auto` engine escalates the stub (empty-body shell) to the browser and
   succeeds, but pays 5 credits for what is just a redirect.
2. The public demo truncates markdown at exactly 8000 characters; on `/ja/` the
   `## メンバー` heading starts at offset 7961, so the demo output stops 39 characters into
   the member section — mid-image-tag, indistinguishable from an extraction failure.

Fixes, both user-approved:

- **Meta-refresh following** as a first-class redirect mechanism: a library parser
  (`extractMetaRefresh`), followed by the CLI/library fetch loader and by the platform's
  fetch-tier engines (same engine, same 1-op billing, SSRF re-check per hop, hop cap 3).
  Root URL then extracts fully for 1 credit.
- **Demo truncation at a paragraph boundary with an in-markdown notice** so a cut can
  never read as an extraction bug.

## Progress

- [x] (2026-08-24 11:52Z) M1: `extractMetaRefresh` + 8 parser tests; fetch loader follows
  with hop cap (stubbed-fetch tests). Acceptance: `bin.js https://delight.sfc.wide.ad.jp/`
  now prints the full member list (25 portraits; was 0)
- [x] (2026-08-24 12:02Z) M2: fetch-tier engines follow meta refresh in `fetchForScrape`
  (same engine, 1 op, SSRF per hop, cap 3; browser tier untouched) — 5 new tests, 25 green
- [x] (2026-08-24 12:03Z) M3: demo truncation cuts at the last blank line within 500 chars
  of the limit and appends an in-markdown notice with the omitted count — 18 demo tests green
- [x] (2026-08-24 12:06Z) M4: 03_api.md revision note + behavioural rules, platform README,
  site api-reference/cli pages; gates green (biome at the 106-warning baseline, root
  typecheck, 202 library/eval tests, 139 platform tests, platform build + prerender gate,
  site build)

## Surprises & discoveries

- The root stub's HTTP status is 200 (GitHub Pages custom redirect page), so HTTP-level
  redirect following never triggers; `curl -sI` shows `HTTP/2 200`.
- `detectClientShell` on the stub: `{"isShell":true,"reason":"empty-body",
  "visibleTextLength":44}` — which is why platform `auto` currently recovers via browser.
- The live demo API on `/ja/` returns `truncated: true` with the output ending
  `"## メンバー\n\n### 教員\n\n![Shigeya Suzuki's por"` — exactly the reported symptom.

## Decision log

- Meta-refresh following applies to **explicit fetch-tier engines too**, not only `auto`:
  it is redirect following (HTTP redirects are already followed by every engine), not
  engine substitution, so the "no silent fallback" invariant is untouched. Browser-tier
  engines are left alone — Chromium follows meta refresh itself. (2026-08-24)
- Guardrails on the parser: a refresh is only a redirect when it names a URL, resolves to
  http(s), is not the page itself, and has a delay ≤ 10s (larger delays are auto-reload
  timers, not redirects). Hop cap 3 everywhere; the platform re-runs `assertPublicHttpUrl`
  on every hop target (redirect-target SSRF policy already documented in 03_api.md).
  (2026-08-24)
- Billing: hops within one scrape bill as one operation of the same engine — identical to
  how HTTP redirects are treated today. (2026-08-24)
- Demo truncation: `DEMO_MARKDOWN_LIMIT` stays 8000 (teaser by design; raising it was
  offered and not taken up). The cut moves back to the last blank line within 500 chars of
  the limit (hard cut when none), and an italic in-markdown notice naming the omitted
  character count is appended, so both the raw pane and the preview show the cut
  explicitly. (2026-08-24)

## Context and orientation

- Library: `packages/webforai/src/loaders/fetch.ts` (`loadHtml(url, userAgent?)`, plain
  fetch + `response.text()`), `src/index.ts` barrel, `src/detect-client-shell.ts` (sibling
  utility, naming/style reference). CLI uses the loader via
  `src/cli/commands/webforai/loadHtml.ts`.
- Platform: `apps/platform/src/core/scrape-core.ts` — `fetchForScrape` resolves `auto`,
  runs the base engine, shell-detects, escalates; the meta-refresh loop goes after the
  base fetch and before shell detection, fetch-tier only. `assertPublicHttpUrl` from
  `core/ssrf.ts`. Demo truncation lives in `apps/platform/src/routes/demo.ts` (`truncate`,
  `DEMO_MARKDOWN_LIMIT`), tests in `demo.test.ts`.
- Docs to sync: `docs/specs/platform/03_api.md` (demo "truncated to 8000 chars", scrape
  behavioural rules), `apps/platform/README.md` (demo line),
  `site/docs/pages/platform/api-reference.mdx` (scrape + demo), `site/docs/pages/cli.mdx`
  (fetch loader description).

## Plan of work

**M1.** `packages/webforai/src/extract-meta-refresh.ts`: `extractMetaRefresh(html,
baseUrl?)` → `{ url, delaySeconds } | undefined`; regex over `<meta>` tags handling
attribute order, quoting variants and `content="N; url=..."` syntax; guards from the
decision log. Export from the barrel. Rewrite `loaders/fetch.ts` `loadHtml` as a loop:
fetch → parse → follow (base = `response.url || current`), cap 3, return the last HTML.
Tests: parser cases (incl. the real delight stub) + a loader test with a stubbed global
fetch proving one-hop follow and the cap.

**M2.** `fetchForScrape`: after the base engine call, when the base is fetch-tier, loop up
to 3 hops re-running the same engine on `assertPublicHttpUrl(refresh.url).href`; then the
existing shell/escalation logic. Tests: stub→content follow (engine stays `fetch`,
credits 1, final `url` is the target), hop-cap stop, private-IP hop target rejected,
browser engines untouched.

**M3.** `routes/demo.ts` `truncate`: boundary search 500, italic notice with omitted count;
demo tests updated (boundary case, hard-cut case, notice presence, `truncated` flag).

**M4.** Docs + revision notes; biome/typecheck/tests/builds; close out this plan.

## Validation and acceptance

- `node packages/webforai/dist/bin.js https://delight.sfc.wide.ad.jp/` (root URL, fetch
  loader) prints the full member list — the previously failing command.
- Platform tests prove: a fetch of the stub re-fetches `/ja/` on the same engine for
  1 credit; demo output on an over-limit page ends at a blank-line boundary followed by
  the truncation notice.
- Full gates: biome, typecheck, library + platform tests, platform build (prerender gate
  still passing), site build.

## Idempotence and recovery

Source edits only; all commands re-runnable. No migrations, no deploys.

## Artifacts and notes

Diagnosis evidence (2026-08-24):

    $ curl -sI https://delight.sfc.wide.ad.jp/ | head -1
    HTTP/2 200
    $ node dist/bin.js https://delight.sfc.wide.ad.jp/ja/ | grep -c portrait
    25        # extractor is fine on /ja/
    $ node dist/bin.js https://delight.sfc.wide.ad.jp/ | grep -c portrait
    0         # the root stub is what fails
    # live demo on /ja/: truncated:true, ends "…## メンバー\n\n### 教員\n\n![Shigeya Suzuki's por"

## Interfaces and dependencies

    // packages/webforai
    export interface MetaRefreshTarget { url: string; delaySeconds: number }
    export const extractMetaRefresh: (html: string, baseUrl?: string) => MetaRefreshTarget | undefined;
    export const MAX_META_REFRESH_DELAY_SECONDS: number; // 10

No new npm dependencies.

## Outcomes & retrospective

(2026-08-24, close-out) Four milestones, four commits. Acceptance holds on the final tree:

- `node packages/webforai/dist/bin.js https://delight.sfc.wide.ad.jp/` — the exact command
  that produced only "Redirecting…" — now prints the full page (25 portraits, `## メンバー`
  present, no warning; `--json` shows the requested URL and complete markdown).
- Platform tests prove the stub re-fetches on the same engine for 1 credit, the hop cap
  holds, private hop targets are rejected, and browser engines are untouched.
- Demo truncation tests prove the cut lands exactly on a blank line of the original
  document with the omitted-count notice appended.

Retrospective: (1) the reported symptom ("the extractor loses the member list") was two
acquisition/presentation problems wearing an extraction costume — the diagnosis pass that
ran the extractor directly against captured HTML before touching any heuristic saved a
pointless tuning exercise; (2) meta-refresh following slotted in cleanly *because* redirect
semantics were already a first-class concept (SSRF redirect policy, final-URL reporting) —
the change is a redirect, not a fallback, so the no-substitution invariant needed no
exception; (3) the truncation fix encodes the misdiagnosis risk itself (a cut must be
visible in the artifact, not only in a flag beside it).
