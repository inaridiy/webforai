# Auto engine with client-shell detection, and a prerendered landing page

This is a living document (see `.agents/PLANS.md`). Keep `## Progress` and
`## Decision log` current; each Progress step ends in a conventional commit.

## Purpose / Big picture

`POST /v1/demo/scrape` (and any fetch-tier engine) against `https://platform.webforai.dev/`
returns a markdown body that is just the `<title>` heading — the site is a client-rendered
React SPA whose HTML is `<div id="root"></div>`. Our own product cannot extract our own
landing page, and any client-rendered site fails the same way. Competitors (Firecrawl)
handle this by detecting that a page needs JavaScript and rendering it.

Two user-visible outcomes:

1. **`engine: "auto"`** (new default): the platform starts with the cheapest suitable
   engine, detects client-rendered shells / anti-bot interstitials in the fetched HTML, and
   escalates to the sibling browser engine. The response reports the engine that actually
   produced the result and bills that engine's price. Explicitly chosen fetch-tier engines
   never escalate; when they hit a shell the response carries a `warning` instead of a
   silent empty body.
2. **`platform.webforai.dev` itself is extractable by plain `proxy-fetch`** with no
   escalation: the landing page is prerendered into `dist/client/index.html` at build time,
   and the build fails if webforai's own conversion of that file comes back empty (the
   "defeat" condition becomes a build gate).

Seeing it work: `pnpm --filter platform test` covers escalation/billing/warning paths;
`pnpm --filter platform build` prints the prerender gate result; converting
`dist/client/index.html` with webforai yields the real hero/pricing copy.

## Progress

- [x] (2026-08-24 11:00Z) M1: `detectClientShell` in `packages/webforai` + tests (9 tests; the
  real fetched platform HTML judges `{"isShell":true,"reason":"spa-shell","visibleTextLength":0}`)
- [ ] M2: platform `auto` engine — types, schemas, scrape-core escalation, billing operation fix, `warning` — + tests
- [ ] M3: demo route on `auto`; landing + playground UI options/copy
- [ ] M4: client surface — platform wire types, CLI `--engine auto`, CLI shell hint, skill content
- [ ] M5: landing prerender + hydration + build gate
- [ ] M6: docs/specs + README/site sync, full gates (biome, typecheck, tests, build)

## Surprises & discoveries

- `curl https://platform.webforai.dev/` returns 965 bytes; `htmlToMarkdownWithMetadata`
  yields exactly `"# webforai platform — crawl to Markdown API\n\n"` — the defeat is real
  and reproducible from the repo (transcript in Artifacts).
- `scrapeSnippet()` in `landing.tsx` already guards `typeof window === "undefined"`, but
  reads `window.location.origin` during render — a hydration text mismatch once the page is
  prerendered; must move the origin into state + effect.
- `recordUsage` is called with `operation: params.request.engine` in both
  `routes/scrape-run.ts` and `jobs/workflow.ts`; with `auto` that would record the literal
  string `auto` while credits vary 1–5. Must switch to the resolved `result.engine`.
- A previous build's `dist/` shows the layout: `dist/client` (assets, incl. `index.html`)
  and `dist/webforai_platform` (worker) — the prerender patch targets
  `dist/client/index.html`. Verify after the first fresh build in M5.

## Decision log

- **Escalation trigger is shell detection only** (client-rendered shell, noscript-only,
  near-empty body, anti-bot interstitial). Engine *errors* do not trigger cross-engine
  fallback in this iteration: error-fallback doubles the failure-semantics surface (which
  error do you report when both engines fail?) and is separable. Recorded as a future
  extension. (2026-08-24, agent)
- **`auto` is the new default engine** for `/v1/scrape|batch|crawl`, the playground and the
  demo. The platform is pre-launch (see 03_api.md revision 2026-08-22 "clean break,
  pre-launch"), and Firecrawl-parity means the default must not return empty bodies on
  SPAs. Billing is by the engine that produced the returned result (1 fetch / 5 browser /
  2 proxy-fetch / 5 proxy-browser), reported in the response `engine` and `credits`
  fields. The escalated run bills only the final engine, not fetch+browser. (2026-08-24)
- **`auto` tier selection**: `region` other than `auto` → proxy tier (`proxy-fetch` →
  `proxy-browser`), because only proxy engines can honour geo-targeting; otherwise plain
  tier (`fetch` → `browser`). `screenshot: true` needs rendering, so `auto` starts directly
  at the tier's browser engine (no wasted fetch). (2026-08-24)
- **Escalation failure is best-effort, not fatal**: if the browser sibling throws
  (unavailable binding, container error), `auto` returns the fetch-tier result with a
  `warning` naming the failed escalation. The engines composition root's "no silent
  fallback" rule is preserved: explicit engines still never substitute, and `auto`'s
  substitution is its documented contract, visible in `engine` + `credits`. (2026-08-24)
- **Detector lives in `packages/webforai`** (`detectClientShell`, exported): it is a generic
  HTML utility (no platform coupling), and the CLI has the same empty-output defeat — it can
  print a "try --engine browser" hint. Platform imports it via the existing `workspace:*`
  dep. (2026-08-24)
- **Demo switches from fixed `proxy-fetch` to fixed `auto`** (still: caller chooses URL +
  region only). The proxy pre-check before the rate limiter now applies only when
  `region !== "auto"` (plain tier needs no proxy), which also lets proxy-less self-hosted
  deployments serve the demo. Demo cost stays bounded by the existing per-IP/global caps.
  (2026-08-24)
- **Prerender is a post-`vite build` script** (`scripts/prerender.ts`, run by the package
  `build` script) using a config-less Vite `ssrLoadModule` of a dedicated
  `entry-static.tsx` (SiteShell path="/" + session `loading` + LandingPage — matches the
  client's first render exactly, so `hydrateRoot` is clean). Dev mode stays a plain SPA;
  `main.tsx` hydrates when `#root` has content, renders otherwise. A tiny inline script
  injected after the markup clears `#root` when `location.pathname !== "/"` so deep links
  served the SPA-fallback HTML don't flash the landing page. The script then converts its
  own output with webforai and **fails the build** if the extracted body is empty/short.
  (2026-08-24)
- **Detector thresholds** (constants in the module, tuned by tests): body visible text
  < 300 chars is "suspicious"; within that, mount-point markers (`id="root"`, `id="app"`,
  `id="__next"`, `id="___gatsby"`…), noscript-requires-JS, anti-bot markers
  (`cf-chl`/`challenge-platform`/"Just a moment"…), or < 50 chars ⇒ shell. ≥ 300 chars is
  never a shell (SSR'd apps with `id="root"` and real content stay un-escalated).
  (2026-08-24)

## Context and orientation

- `apps/platform` — Cloudflare Workers SaaS. Key files:
  - `src/core/types.ts` — `ENGINES`, `ScrapeRequest`, `FetchedPage`, `ScrapeSuccess`,
    `EngineSet`. `src/core/scrape-core.ts` — `fetchForScrape` (guards + acquisition; the
    crawl Workflow needs raw HTML for link discovery) and `convertFetchedPage`
    (convert/artifacts/price); `scrapePage` composes both.
  - `src/engines/index.ts` — composition root, one function per engine, deliberately no
    fallback between engines.
  - `src/routes/schemas.ts` — zod bodies (strict); `src/routes/demo.ts` — public demo
    (fixed request, KV rate limits); `src/routes/scrape-run.ts` — sync run + `recordUsage`;
    `src/jobs/workflow.ts` — per-page step (`runPage`) with its own `recordPageUsage`.
  - `src/billing/credits.ts` — `ENGINE_CREDITS` (docs/specs/platform/04_billing.md mirrors).
  - `src/client/*` — React 19 SPA: `main.tsx` (createRoot), `app.tsx` (path switch),
    `components/site-shell.tsx`, `pages/landing.tsx` (engines table, curl snippet reading
    `window.location.origin` in render), `components/landing/demo-section.tsx` (copy says
    "proxy-fetch engine"), `pages/playground.tsx` (engine select, `SCREENSHOT_ENGINES` /
    `PROXY_ENGINES` sets, `ENGINE_HINTS`).
  - Build: `vite build` with `@cloudflare/vite-plugin` → `dist/client` (assets incl.
    `index.html`) + `dist/webforai_platform` (worker). `wrangler.jsonc` assets:
    `single-page-application` fallback, `run_worker_first` for `/v1|/api|/artifacts|/health`.
- `packages/webforai` — the published library. `src/index.ts` re-exports; platform client
  wire types in `src/platform/types.ts` (`ENGINES` mirror, request/response shapes); CLI in
  `src/cli/commands/webforai/{options,run,interactive}.ts`, agent-skill text in
  `src/cli/commands/skill/content.ts`.
- Specs: `docs/specs/platform/03_api.md`, `04_billing.md` (update with dated revision
  notes, don't rewrite). Site docs live in `site/` (grep for engine tables when syncing).

Terms: *fetch tier* = `fetch`/`proxy-fetch` (no JS execution); *browser tier* =
`browser`/`proxy-browser` (rendered, screenshot-capable). *Shell* = HTML whose visible body
text is (near-)empty because content is built client-side, or an anti-bot interstitial.

## Plan of work

**M1 — detector (library).** New `packages/webforai/src/detect-client-shell.ts` exporting
`detectClientShell(html): { isShell: boolean; reason?: "empty-body" | "spa-shell" |
"noscript-only" | "anti-bot-challenge"; visibleTextLength: number }` plus the threshold
constants. Implementation: take `<body>` (fall back to whole document), strip
script/style/template/svg/noscript (noscript content inspected separately), strip tags,
decode the common entities, collapse whitespace; apply the decision table from the decision
log. Export from `src/index.ts`. Tests in `src/detect-client-shell.test.ts` with inline
fixtures: the real platform shell (from the transcript below), a Next-style shell with
noscript, a Cloudflare challenge page, `example.com`-like small static page (NOT shell),
an article (NOT shell), an SSR'd page with `id="root"` + content (NOT shell).

**M2 — auto engine (platform).** `core/types.ts`: add
`REQUESTED_ENGINES = [...ENGINES, "auto"]`, `RequestedEngine`; `ScrapeRequest.engine:
RequestedEngine`; `ScrapeSuccess` gains `warning?: string`; add
`AcquiredPage = FetchedPage & { engine: Engine; warning?: string }`.
`core/scrape-core.ts`: `fetchForScrape` resolves `auto` (tier by region, screenshot starts
at browser), runs the base engine, on `isShell` escalates to the sibling browser engine
(catching escalation errors → base result + warning); explicit fetch-tier engines get the
shell `warning` only. Returns `AcquiredPage`. `convertFetchedPage` takes `AcquiredPage`,
uses `page.engine` for the response/credits and forwards `warning`. The screenshot guard
allows `auto`. `routes/schemas.ts`: engine enum includes `auto`, default `auto`;
`requireScreenshotCapableEngine` accepts `auto`. `routes/scrape-run.ts` and
`jobs/workflow.ts`: `operation` (and the workflow's job-results failure `engine` typing)
use the resolved/requested values correctly (`result.engine` for usage). Tests: scrape-core
escalation matrix (shell→browser, non-shell stays, region→proxy pair, screenshot→browser
direct, explicit engine warns, escalation failure warns + bills 1), schema defaults,
workflow billing operation.

**M3 — demo + UI.** `routes/demo.ts`: `DEMO_ENGINE = "auto"`, proxy pre-check only when
`region !== "auto"`; demo response unchanged in shape. `demo-section.tsx` copy (auto
engine), `landing.tsx` engines table gains an `auto` row (credits "1–5") and the curl
snippet uses `"engine": "auto"`; hero copy still says four engines + auto default;
`playground.tsx`: `auto` option first + hint, include `auto` in the screenshot-capable and
region-applies sets. Demo tests updated.

**M4 — client surface (library).** `src/platform/types.ts`: `RequestedEngine`
(`Engine | "auto"`) for request options and page-failure `engine`; `ScrapeResult.warning?`.
CLI `options.ts`/`interactive.ts`: allow/offer `auto`; `run.ts`: when local conversion (no
`--engine`) produces a shell (`detectClientShell` on the fetched HTML), print a stderr hint
to retry with `--engine auto`; skill `content.ts` engine list mentions `auto`. Library
tests for options.

**M5 — prerender.** `src/client/entry-static.tsx` (renderToString of
StrictMode→SiteShell(path "/", session loading)→LandingPage);
`landing.tsx` snippet origin moved to `useState("https://platform.webforai.dev")` +
`useEffect` set from `window.location.origin`; `main.tsx` hydrates when `#root` has
content; `scripts/prerender.ts` (vite `ssrLoadModule`, inject markup + the pathname-clear
inline script into `dist/client/index.html`, then convert the patched file with webforai
and throw if the post-frontmatter body is < 500 chars); package `build` becomes
`vite build && tsx scripts/prerender.ts`.

**M6 — docs + gates.** 03_api.md (auto semantics, `warning`, new default, demo engine),
04_billing.md (auto bills resolved engine), platform README, root README if engines are
listed, `site/` engine docs, landing/demo copy double-check. Run biome, typecheck, tests,
builds for both packages; update this plan's Outcomes.

## Validation and acceptance

- `pnpm test` (root) passes; new detector tests demonstrate: the saved
  platform.webforai.dev HTML ⇒ `isShell: true, reason: "spa-shell"`; an article ⇒ false.
- `pnpm --filter platform test` passes; a scrape of a shell page with default request
  resolves `engine: "browser"`, `credits: 5`; with `engine: "fetch"` explicitly it stays
  `credits: 1` and carries `warning`.
- `pnpm --filter platform build` succeeds and prints the prerender gate line; afterwards
  `node --input-type=module -e` converting `dist/client/index.html` with
  `htmlToMarkdownWithMetadata` prints markdown containing "Any URL, converted to Markdown"
  and the engines table content — the command and transcript go in Artifacts.
- `pnpm typecheck`, `pnpm lint` (biome) green at every commit.

## Idempotence and recovery

All edits are plain source edits; re-running tests/builds is safe. The prerender script
is idempotent (it replaces the `#root` element wholesale on each build; a second run against
an already-patched file fails its "empty root div" match — acceptable because it always runs
right after a fresh `vite build`). No migrations, no deploys; `wrangler deploy` remains a
user action.

## Artifacts and notes

Reproduction of the defeat (2026-08-24):

    $ curl -sL https://platform.webforai.dev/ | wc -c
    965
    $ node --input-type=module -e "import { htmlToMarkdownWithMetadata } from './packages/webforai/dist/index.js'; ..."
    markdown: "# webforai platform — crawl to Markdown API\n\n"
    metadata: {"title":"webforai platform — crawl to Markdown API","description":"Turn any URL into clean Markdown. ...","lang":"en"}

## Interfaces and dependencies

End state (prescriptive):

    // packages/webforai
    export type ClientShellReason = "empty-body" | "spa-shell" | "noscript-only" | "anti-bot-challenge";
    export interface ClientShellVerdict { isShell: boolean; reason?: ClientShellReason; visibleTextLength: number }
    export const detectClientShell: (html: string) => ClientShellVerdict;

    // apps/platform/src/core/types.ts
    export const REQUESTED_ENGINES = ["fetch", "browser", "proxy-fetch", "proxy-browser", "auto"] as const;
    export type RequestedEngine = (typeof REQUESTED_ENGINES)[number];
    export interface ScrapeRequest { engine: RequestedEngine; /* rest unchanged */ }
    export type AcquiredPage = FetchedPage & { engine: Engine; warning?: string };
    export interface ScrapeSuccess { engine: Engine; warning?: string; /* rest unchanged */ }

    // apps/platform/src/core/scrape-core.ts
    export const fetchForScrape: (deps, req) => Promise<AcquiredPage>;
    export const convertFetchedPage: (deps, req, page: AcquiredPage) => Promise<ScrapeSuccess>;

No new npm dependencies anywhere.

## Outcomes & retrospective

(To be filled at milestones and close-out.)
