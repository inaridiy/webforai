# ExecPlan: docs unification, vendor-word removal, @webforai/platform client, CLI overhaul

Living document (contract: `.agents/PLANS.md`). Branch: `feat/platform`.
Prior initiative: `.agents/execplans/2026-08-10-platform.md` (platform bring-up + test deploy).

## Purpose / Big Picture

Four user-visible outcomes:

1. **One documentation source.** webforai.dev (the vocs site in `site/`) is the only place the
   platform API is documented. platform.webforai.dev keeps its marketing landing page but its
   in-SPA `/docs` page (which had already drifted from the site docs) is gone; every "docs"
   link on the platform points at webforai.dev. The site docs gain a real "how to use the
   platform" guide (key creation → curl → client → CLI) and their factual drift against the
   deployed code is fixed.
2. **No vendor / internal-operations words in the repo.** The egress-proxy vendor's name is
   removed everywhere — copy, comments, env var names, specs, evals, reference notes, plan
   history — replaced by provider-neutral wording and provider-neutral configuration
   (`PROXY_URL` / `PROXY_USERNAME` / `PROXY_PASSWORD` secrets). The engine id `cf-browser` is
   renamed to `browser`.
3. **`@webforai/platform`** (new `packages/platform`): a dependency-free typed TypeScript
   client for the platform HTTP API (scrape/batch/crawl/jobs, polling and paging helpers),
   published to npm alongside `webforai`.
4. **A CLI built for automation.** `npx webforai <url>` converts and prints Markdown to stdout
   with no prompts; `--json` emits a machine-readable envelope; `-i/--interactive` opts into
   the old guided wizard; the platform is available as a loader (`-l platform`, or implied by
   `--engine/--region`) using `@webforai/platform`; `webforai skill` prints/installs an Agent
   Skill so coding agents can teach themselves the tool; `-h` is self-sufficient (flags,
   examples, env vars, exit codes, JSON schema).

To see it working at the end: `pnpm build && node packages/webforai/dist/bin.js https://example.com`
prints Markdown; `node packages/webforai/dist/bin.js https://example.com --json | jq .markdown`
works; `webforai skill` prints a SKILL.md; a case-insensitive grep for the proxy vendor's name
over tracked files returns nothing;
`pnpm --filter platform test` and the site build stay green.

## Progress

- [x] (2026-08-22) Survey: docs site map, platform API surface map, CLI/current library API,
      all vendor-name / `cf-browser` occurrences enumerated. Plan authored.
- [ ] M1 platform: engine rename `cf-browser`→`browser`, proxy env genericization
      (`PROXY_URL`/`PROXY_USERNAME`/`PROXY_PASSWORD`), SPA `/docs` removal + external doc
      links, landing/playground copy, README. Gates green.
- [ ] M2 prose sweep: specs revision notes, `docs/references`, evals, plan history,
      root/package READMEs. Vendor-name grep clean.
- [ ] M3 `packages/platform` (@webforai/platform) client + unit tests + README + changeset.
- [ ] M4 CLI overhaul + `webforai skill` + tests + changeset + package README.
- [ ] M5 site docs: `/cli` page, platform section rewrite (+ client page, usage guide),
      landing/getting-started/installation updates, sidebar/nav, DemoScrape copy, footer
      license fix.
- [ ] M6 close-out: full gates, README drift pass, retrospective.

## Surprises & Discoveries

- The platform SPA's `/docs` page and `site/docs/pages/platform/api-reference.mdx` had both
  drifted from the deployed code before this initiative (results envelope is
  `{ jobId, status, results, cursor? }`, not `{ items, cursor }`; no `region` field in any
  success response; demo 200 carries a top-level `title`; usage `operation` is the bare
  engine id, not `scrape:fetch`). Evidence: `apps/platform/src/routes/v1.ts:184-189`,
  `core/types.ts:50-61`, `routes/demo.ts:274-276`, `routes/scrape-run.ts:77`, e2e assertion
  `tests/e2e/api.e2e.test.ts:98-107`. Fixed in M5 docs; the duplicate in-SPA reference is
  deleted in M1 rather than fixed twice.
- `site/docs/footer.tsx` said "MIT License" while the repo license and landing badge are
  Apache-2.0. Fixed in M5 (fix-noise-once).
- `site/docs/components/platform.ts` claimed the demo endpoint is "overridden at deploy time"
  — no such indirection exists; comment corrected in M5.
- `@better-auth/api-key` returns `RATE_LIMITED`-family codes that the middleware flattens to
  `429 rate_limited` without `Retry-After`; only the demo route sends `Retry-After`
  (`routes/demo.ts:260`). The client therefore treats `retryAfter` as optional everywhere.
- (add findings here as milestones run)

## Decision log

- 2026-08-22: **Docs integration direction**: webforai.dev is the single documentation
  source; the platform SPA keeps landing/dashboard/playground only, and `/docs` inside the
  SPA is deleted with links pointing at `https://webforai.dev/platform/...`. Rationale: the
  two references had already diverged (see Surprises); self-hosters read the same routes.
- 2026-08-22: **Engine id `cf-browser` → `browser`** (set: `fetch | browser | proxy-fetch |
  proxy-browser`). Clean break, no accepted alias: the platform is pre-launch (Stripe test
  mode, no external users). Old `usage_events.operation` rows keep the old string; the
  dashboard renders it as-is, which is acceptable audit history.
- 2026-08-22: **Proxy configuration is provider-neutral**: secrets `PROXY_URL` (e.g.
  `http://host:port`), `PROXY_USERNAME`, `PROXY_PASSWORD` replace the former vendor-named
  username/password secret pair and the hardcoded gateway hostname. `proxyEnabled` now
  requires all three. The username suffix convention (`-{CC}`, `-rotate`) stays implemented
  but is described generically ("gateway encodes per-request options as username suffixes").
  **Operator migration (before next deploy): `wrangler secret put PROXY_URL` /
  `PROXY_USERNAME` / `PROXY_PASSWORD`, then delete the two old vendor-named secrets.**
- 2026-08-22: Vendor words are scrubbed from *history* files too (`.agents/execplans/`,
  `docs/references/`) because the repo is public and the words are the secret, not the
  decisions. Reference facts that were vendor-specific are rewritten with placeholders.
- 2026-08-22: **Client is a separate package** `packages/platform` → npm `@webforai/platform`
  (user's suggestion "@webforai/platform として切ってもいい"). Zero runtime deps, `fetch`-based,
  works on Node ≥18 / browsers / Workers. `webforai` (the CLI) depends on it via
  `workspace:^`. NOTE for release: the npm scope `@webforai` must exist before `changeset
  publish` (operator action).
- 2026-08-22: **CLI defaults flip to non-interactive**: positional URL/file + flags; wizard
  only behind `-i/--interactive`; output to **stdout** unless `-o` (old behavior wrote a file
  after prompting). Folded into the already-pending `webforai` major release.
- 2026-08-22: `--engine`/`--region` imply `-l platform`; API key from `--api-key` or
  `WEBFORAI_API_KEY`; base URL from `--platform-url` or `WEBFORAI_PLATFORM_URL` (default
  `https://platform.webforai.dev`).
- 2026-08-22: Agent Skills: `webforai skill` prints a SKILL.md (agentskills.io format:
  YAML frontmatter `name`/`description` + usage body); `webforai skill --install [--dir D]`
  writes `D/webforai/SKILL.md`, default `D = .claude/skills`.
- 2026-08-22: Marketing/docs engine tables drop runtime internals ("Node container, undici",
  vendor column) in favour of capability wording (proxy yes/no, browser rendering yes/no,
  screenshot, credits). Architecture-level Cloudflare facts stay in README/specs — the
  deployment target is public knowledge, the egress vendor is not.
- 2026-08-22: M1 addendum — `landing.tsx` hero sub-copy and `index.html` meta description
  reworded ("proxied fetch, proxied browser, browser rendering"); playground engine hint for
  `browser` says "Browser rendering · 5 credits" (no "Cloudflare"): capability wording only.
- 2026-08-22: M3 API shape — factory `createPlatformClient(options)` returning a plain object
  (matches repo's function-record style): `scrape`, `scrapeAsync`, `batch`, `crawl`, `getJob`,
  `getJobResults`, `waitForJob`, `jobResults` (async generator, auto-fetches R2-spilled
  `resultUrl` stubs by default), `demoScrape`. Errors throw `PlatformApiError` with `code`,
  `status`, `retryAfter?`. `crawl`'s `sameOrigin` typed `true | undefined` (server rejects
  `false`). `waitForJob` polls with default interval 2s, timeout 10min.
- 2026-08-22: M4 — CLI splits into `run.ts` (non-interactive core), `interactive.ts` (wizard),
  `skill.ts` (Agent Skill). `--json` envelope: `{ source, loader, url?, engine?, region?,
  markdown, metadata, credits?, screenshotUrl?, output? }` (markdown/metadata always present;
  platform-only fields when the platform loader ran; `output` when `-o` wrote a file). All
  logs to stderr, only markdown/JSON on stdout. Exit codes: 0 ok, 1 runtime failure, 2 usage
  error (commander's `exitOverride` mapped). No `--mode`+`--extractor` conflict handling —
  both pass through (`mode` maps to link/table/image toggles, `extractor` to the pipeline).

## Context and Orientation

Monorepo (pnpm 9, biome, vitest at root, changesets). Key paths:

- `packages/webforai` — the published library + CLI (`src/cli/bin.ts`, commander; wizard
  helpers under `src/cli/helpers` using @clack/prompts). Built by `build.ts` (esbuild: ESM,
  CJS, and a bundled `dist/bin.js` with `packages: "external"`). A **major** changeset
  (`.changeset/major-extraction-overhaul.md`) is already pending → v3.
- `packages/platform` (NEW) — `@webforai/platform` client.
- `apps/platform` — Cloudflare Worker SaaS (Hono `/v1` API + Better Auth + Stripe + React
  SPA). Engine enum `ENGINES` in `src/core/types.ts`; zod schemas `src/routes/schemas.ts`
  (strict bodies); engines composition `src/engines/index.ts`; container code
  `src/engines/node.container.ts` (undici/Playwright through the proxy); typed env
  `src/env.ts`; secrets forwarded to the container via `workerEnvVars` in `vite.config.ts`
  (regenerates `src/__generated__/create-nodejs-fn.do.ts` at build). SPA pages
  `src/client/pages/{landing,docs,playground,dashboard,...}.tsx`, shell nav
  `src/client/components/site-shell.tsx`.
- `site` — vocs docs site (webforai.dev). Config `site/vocs.config.ts` (sidebar/topNav);
  pages `site/docs/pages/**`; platform section `platform/{index,api-reference,billing}.mdx`;
  demo widget `site/docs/components/DemoScrape.tsx` + endpoint const
  `site/docs/components/platform.ts`.
- `docs/specs/platform/01..04` — design ledger (update with dated revision notes, never
  rewrite); `docs/references/platform-research-2026-08.md` — research facts; evals proxy code
  `evals/src/{config,proxy}.ts`, `evals/README.md`.

API facts the client/docs must match (verified against code, see Surprises):
`POST /v1/scrape` → `ScrapeSuccess { url, engine, markdown, metadata, credits,
screenshotUrl?, images? }` (no `region`); `async: true` → `202 { jobId }`; `POST /v1/batch`
(≤100 urls) and `POST /v1/crawl` (maxDepth ≤5 default 2, limit ≤500 default 50,
`sameOrigin: true` literal) → `202 { jobId }`; `GET /v1/jobs/:id` →
`{ jobId, type, status, total, completed, failed, credits, expiresAt, error? }`;
`GET /v1/jobs/:id/results?cursor` → `{ jobId, status, results: PageResult[], cursor? }`,
page size 20, items >100KiB replaced by `{ status:"ok", url, engine, credits, resultUrl }`;
errors `{ error: { code, message } }` (+`retryAfter` on demo 429); auth
`Authorization: Bearer wfa_...` or `x-api-key`; artifact URLs expire in 24h; results TTL 7d.
Request bodies are `.strict()` — unknown keys are 400s, so the client must not add fields.

## Plan of Work

**M1 — platform code (apps/platform).** Rename engine id in `core/types.ts`
(`ENGINES = ["fetch", "browser", "proxy-fetch", "proxy-browser"]`), rename
`engines/cf-browser.ts` → `engines/browser.ts` (`browserEngine`), fix all imports/labels;
sweep string literal `cf-browser` in src + tests. Env: `env.ts` schema keys `PROXY_URL`,
`PROXY_USERNAME`, `PROXY_PASSWORD` (proxyEnabled = all three); `vite.config.ts`
`workerEnvVars`; `engines/container-env.d.ts`; `node.container.ts` reads the server URL from
env instead of the hardcoded const; error/comment wording provider-neutral;
`tests/e2e/config.ts` fake env names + `PROXY_URL=http://127.0.0.1:9`; regenerate
`__generated__` via build. Delete `client/pages/docs.tsx`; `client/app.tsx` route removed;
`site-shell.tsx` nav/footer "API reference" → `https://webforai.dev/platform/api-reference`;
landing CTAs likewise; landing engines table + playground hints reworded (no vendor, new
ids). Update `apps/platform/README.md` (same commit: env vars, engine table, links, secret
migration note). Gates: `pnpm --filter platform test|typecheck|build`.

**M2 — prose sweep.** `docs/specs/platform/01..04` engine/vendor wording + revision notes;
`docs/references/platform-research-2026-08.md` proxy-vendor section → provider-neutral with
placeholder hosts; `evals/src/config.ts`, `evals/src/proxy.ts`, `evals/README.md`;
`.agents/execplans/2026-08-10-platform.md` vendor words; root `README.md` +
`packages/webforai/README.md` platform blurbs. Acceptance: vendor-name grep → empty.

**M3 — packages/platform.** Scaffold package (package.json name `@webforai/platform`,
version 0.0.0, exports ESM+CJS+types, build via esbuild script mirroring webforai's
`build.ts`, tsconfigs, README). `src/types.ts` (Engine/Region/requests/responses),
`src/error.ts`, `src/client.ts` (`createPlatformClient`), `src/index.ts`. Unit tests with a
stubbed `fetch` (vitest root picks them up): happy paths, error envelope → `PlatformApiError`
(code/status/retryAfter), paging iterator incl. `resultUrl` stub resolution, `waitForJob`
terminal/timeout. Changeset (minor). Root `pnpm build` covers it via `packages/**` filter.

**M4 — CLI.** `webforai` deps + `@webforai/platform` workspace:^. Rework
`src/cli`: `bin.ts` (commander, `exitOverride`, rich `-h`, `skill` subcommand),
`commands/webforai/run.ts` (non-interactive pipeline: resolve loader — local file / fetch /
playwright / platform; convert via library or platform; emit stdout or `-o`; `--json`
envelope), `commands/webforai/interactive.ts` (wizard reusing clack helpers; extended with
platform loader prompts), `commands/skill/` (SKILL.md content + `--install`). Keep
`loadHtml.ts` for fetch/playwright/local. Unit tests: json envelope builder, extractor/mode
mapping, skill content contains every flag, spawn smoke test (`tsx src/cli/bin.ts <fixture>`
→ stdout markdown; `--json` parses). Changeset (major already pending covers the break; add
a dedicated changeset describing the CLI + client so the release notes mention it).

**M5 — site docs.** New `docs/pages/cli.mdx` (reference + agent section). Platform section:
`platform/index.mdx` (overview + quickstart: signup → key → curl → client → CLI; engine
table reworded), NEW `platform/client.mdx` (@webforai/platform usage), `platform/
api-reference.mdx` (fix results envelope/`region` claims/demo `title`/`sameOrigin`; rename
engine; vendor removal), `platform/billing.mdx` (schedule with `browser`, neutral wording).
`getting-started.mdx` CLI quickstart rewrite; `installation.mdx` tab fix; `index.mdx`
landing (engine bullets, add client mention, CLI feature); `vocs.config.ts` sidebar/topNav
(+CLI, +Client); `DemoScrape.tsx` footer copy; `docs/footer.tsx` Apache-2.0;
`components/platform.ts` comment. Build site to verify.

**M6 — close-out.** `pnpm format:fix && pnpm lint && pnpm lint:repo && pnpm typecheck &&
pnpm build && pnpm test`; `pnpm --filter platform test && typecheck && build`; site build;
README drift pass; retrospective; final commit.

## Validation and Acceptance

- case-insensitive vendor-name grep on tracked files → no hits; `git grep -w cf-browser` →
  hits only in dated revision notes that record the rename itself.
- `pnpm --filter platform test` green; `pnpm test` (root) green; `pnpm typecheck`,
  `pnpm build`, `pnpm --filter platform build`, `pnpm --filter site build` green;
  `pnpm format` + `pnpm lint` + `pnpm lint:repo` clean.
- `node packages/webforai/dist/bin.js <local html fixture>` prints Markdown to stdout,
  writes nothing; `--json` output parses and carries `markdown` + `metadata`; `-o out.md`
  writes the file; `webforai skill` prints SKILL.md with frontmatter; `--install` writes
  `.claude/skills/webforai/SKILL.md`; `-h` lists every flag with examples.
- Platform e2e suite (`pnpm --filter platform test:e2e`) run if Docker is available on this
  machine; otherwise noted here as not-run (deploy-time live check remains on the operator's
  list along with the secret migration).
- Live platform verification (deploy + `PROXY_*` secrets) is an **operator step**, recorded
  in the 2026-08-10 plan's remaining-work list; nothing in this initiative changes routes or
  billing semantics — only the engine id string and env names.

## Idempotence and Recovery

All edits are plain-text and committed per milestone with conventional commits; a failed
milestone can be reverted by dropping its commits. The generated
`create-nodejs-fn.do.ts` is regenerated by `pnpm --filter platform build` — never hand-edit
except to keep the tree type-checking between config change and first build. Engine rename
is atomic within M1; the tree never ships with both ids live.

## Interfaces and Dependencies (target)

`@webforai/platform` public surface:

    createPlatformClient(options: { apiKey: string; baseUrl?: string; fetch?: typeof fetch })
      → { scrape(req): Promise<ScrapeResult>;
          scrapeAsync(req): Promise<{ jobId: string }>;
          batch(req): Promise<{ jobId: string }>;
          crawl(req): Promise<{ jobId: string }>;
          getJob(id): Promise<JobStatus>;
          getJobResults(id, opts?: { cursor?: string }): Promise<JobResultsPage>;
          waitForJob(id, opts?): Promise<JobStatus>;              // terminal status or throw on timeout
          jobResults(id, opts?): AsyncGenerator<PageResult>;      // pages + resolves resultUrl stubs
          demoScrape(req): Promise<DemoResult> }                  // no key required
    class PlatformApiError extends Error { code: string; status: number; retryAfter?: number }
    type Engine = "fetch" | "browser" | "proxy-fetch" | "proxy-browser"
    type Region = "auto" | "us" | "eu" | "uk" | "jp" | "asia"

CLI: `webforai [source] [-o path] [-l fetch|playwright|platform] [-m default|ai]
[--extractor auto|takumi|minimal|none] [--frontmatter] [--json] [--engine E] [--region R]
[--api-key K] [--platform-url U] [-i] [-d]` and `webforai skill [--install] [--dir D]`.

## Outcomes & Retrospective

(to be filled at milestones and close-out)
