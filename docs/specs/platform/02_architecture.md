# Platform Architecture

Revision note (2026-10-08, container image): The container image is `node:24.21.0-bookworm-slim`
plus Playwright's headless Chromium shell and its system dependencies (`playwright install
--with-deps --only-shell chromium`), instead of `mcr.microsoft.com/playwright`, which also ships
full Chromium, Firefox and WebKit. `chromium.launch({ headless: true })` already ran the headless
shell, so the browser build is the same. Docker 29.8's reported size went 3.68 GB → 1.33 GB:
wrangler's pre-deploy check (`.Size` × 1.1 + 16 MiB per layer against the `basic` instance's
4,000 MB) had started failing after a Docker upgrade counted unpacked and packed content
together. The browser version now follows the `playwright` dependency, so no base-image tag has
to match it. Measured on `basic` limits (¼ vCPU, 1 GiB), 20 cached pages × 3 interleaved rounds:
launch, render, `content()` and screenshot totals within run-to-run noise (71.3 s vs 71.5 s).

Revision note (2026-10-05, script bodies): Browser engines (`browser`, `proxy-browser`) empty the
script and style bodies conversion never reads (`stripScriptBodies` from the library: JSON-LD,
YouTube's player response and bot-challenge scripts are kept) before the 5 MiB check, so inline
bundles no longer push a page over the cap; `proxy-fetch` does the same inside the container before
returning, after the raw-body cap that bounds proxy bandwidth. Over the 60-page corpus the HTML is
45% smaller and the Markdown, metadata, extraction report and shell verdict are identical.
Revision note (2026-10-05, internal RPC v2): `PlatformRpc` gains `tryConvert(url, options)`,
which returns `{ ok: true, result } | { ok: false, error }` instead of throwing; `convert` keeps
throwing `code: message` for existing callers. The wire types are `PlatformRpc` and the `Rpc*`
types in `webforai/platform`; `src/rpc/convert.ts` implements them (`implements` on the
entrypoint), so the published types follow the deployment. Options add `frontmatter` and
`titleHeading` (both default `true`; a body-only caller sends `false`), accept every extractor
preset, and drop unknown keys instead of rejecting them (a newer client can call an older
deployment). Results add a literal `engine` (`fetch | browser`), `metadata` limited to the
library's `PageMetadata` fields with `published`/`modified` as ISO-8601 when they parse,
`extraction` (`extractor`, `confidence` or `null`, `textLength` of the body; no platform-side
confidence threshold — the caller decides what is too low), coded
`warnings[]` (`client_shell_unrendered`, `browser_timeout` — the render budget ran out before
network idle, `meta_refresh_followed`) and
`images[]` (absolute public URLs left in the markdown, outside code fences); `warning` stays for
compatibility. Errors carry `code` (`invalid_request | invalid_url | rate_limited | fetch_failed |
unsupported_content_type | response_too_large | engine_failed | internal_error`), `httpStatus`
(the upstream status of a `fetch_failed`), `contentType` (of an `unsupported_content_type`, e.g.
`application/pdf`) and `retryable`: false for bad input, unsupported or oversized content, an
exhausted `auto` escalation and an upstream 4xx other than 408/425/429; true otherwise.
Tenants: `shadcn-explorer`, `rebabel-prod`, `rebabel-dev` (`RATE_LIMIT_INTERNAL` is per tenant).
Both browser engines now run the library's `annotateGeometry` before reading the DOM (as the
library's loaders do since #73), and report when navigation never reached network idle.
Revision note (2026-10-01): moved from README (operator/dashboard internals). Dashboard: a
"Get set up" checklist (key → first request → optional billing) until the account has a key and
usage; one usage panel (credits this month, estimate from `PRICE_TIERS`, plan + billing
actions); a "Use your key" card (curl / TS client / CLI, `baseUrl` / `WEBFORAI_PLATFORM_URL`
filled in on self-hosted origins). Doc URLs live in `src/client/lib/links.ts`. Account deletion
(`POST /api/dashboard/account/delete` with `{ confirmEmail }`): terminate queued/running job
Workflows (best-effort), flush unreported usage to the Stripe meter and cancel an active
subscription with an immediate final invoice (either failing deletes nothing), then delete keys,
jobs, usage, billing state, pending codes, sessions, linked accounts and the user row in one D1
batch; R2 job archives are removed best-effort (paging past 1,000; the 7-day lifecycle catches
the rest). Legal pages `/terms`, `/privacy`, `/commerce` are SPA routes also prerendered by
`pnpm build` to `dist/client/*.html` (served under `html_handling: auto-trailing-slash`, metadata
from `src/client/lib/page-meta.ts`); `public/` holds `og.png`, `robots.txt`, `sitemap.xml` and
the PWA files. PWA: manifest starts on `/dashboard`; the service worker registers only in
production builds (`pnpm build && pnpm exec vite preview` locally, Docker required), loads
navigations network-first with a 4 s cached-shell fallback, `/assets/*` cache-first, other
static files stale-while-revalidate, never stores prerendered legal pages as the shell
(`OWN_DOCUMENT` in `sw.js`); display cache keys `wfa-cache:v1:*` (`src/client/lib/local-cache.ts`)
with a "Showing saved data" notice and **Clear saved data**; `share_target` GET
`/share?url=&text=&title=` prefills the playground (signed in) or landing demo (signed out) via
`?url=` without running. Shell uses `min-h-dvh` and safe-area insets; phone inputs are 16px.
Rollout of the page-accounting migration (`drizzle/0001_wild_miek.sql`): stop accepting new
async jobs, let old workflows finish, apply the migration, deploy the matching Worker, resume
job creation; do not roll back while new jobs are active. Migration 0004
(`usage_events.report_skipped_reason`, its index, `billing_state.spend_cap_usd`) must be applied
before deploying the code that uses it.
Revision note (2026-10-01, internal RPC): The Worker also exports `PlatformRpc`, a
`WorkerEntrypoint` for Service Binding callers on the same account (first: shadcn-explorer).
`convert(url, { tenant, formats, extractor, engine })` runs `fetchForScrape` +
`convertFetchedPage` directly, outside the product layer (no API key, tier limit, spend guard,
ledger or Stripe); it keeps the SSRF guard, Browser Run and a per-tenant
`RATE_LIMIT_INTERNAL` binding (300/min), and offers only `auto`/`fetch`/`browser`. Errors cross
RPC as `code: message`. The platform build now builds the `webforai` library first: the
Worker imports its `dist`, and a stale `dist` shipped an old converter once (2026-10-01).
Revision note (2026-10-01, security): Hardening layer. Worker responses get baseline security
headers (HSTS, nosniff, `X-Frame-Options: DENY`, referrer policy) and `/api/*`, `/v1/*` a 256 KiB
body cap (`src/routes/security.ts`); state-changing `/api/dashboard/*` requests must carry
`Origin` = `BASE_URL` origin. The SPA's headers (CSP with a pinned sha256 for the prerender's
inline script, Turnstile allowances, `worker-src`/`manifest-src 'self'`, HSTS,
`frame-ancestors 'none'`, Permissions-Policy, COOP) live in `public/_headers`, which Workers
Assets applies; `src/routes/spa-headers.test.ts` fails when the inline script and the hash
drift. Redirects are walked manually with the SSRF guard on every hop (`src/core/redirects.ts`,
shared with the container); both browser engines route every request through
`src/engines/page-guard.ts`. Rehosting is raster-only and `/artifacts/*` is served under a
sandboxing CSP (see 03_api.md).
Revision note (2026-10-01, limits): New Workers Rate Limiting bindings `RATE_LIMIT_FREE`
(60/60 s), `RATE_LIMIT_PAID` (600/60 s) keyed by user id for `/v1`, and `DEMO_RATE_LIMIT`
(3/60 s) keyed by client IPv4 / IPv6 /64 for the demo; Better Auth's per-key D1 limiter is
disabled (key verification still writes `lastRequest`). Ops alerts (`src/ops/alert.ts`) email
`OPS_ALERT_EMAIL` through the `EMAIL` binding when proxy bandwidth crosses 80% / 95% (once per
threshold per period, KV marker `ops:alert:*`) or a cron pass throws (at most hourly).
Production sign-in with `TURNSTILE_SITE_KEY` but no secret fails closed (500).
Revision note (2026-09-30, PWA): The SPA is installable (`public/manifest.webmanifest`,
`public/sw.js`). The service worker only caches the public app shell and static assets. It
never intercepts the Worker's routes (`/v1`, `/api`, `/artifacts`, `/health`), so no account
data or credentials reach Cache Storage. Per-account display data (session user, usage, key
list without secrets, jobs) is kept as a client-side stale-while-revalidate cache in
`localStorage`. Every read is re-validated with the response's zod schema, and sign-out,
account deletion or an anonymous session response clears it. The hook reads that cache after
mount (layout effect), so the prerendered landing page still hydrates against a `loading`
session.

Revision note (2026-09-24, sign-in): New `EMAIL` (`send_email`, sender-restricted) binding
for sign-in codes; Better Auth's rate limiter moved to D1 (`rate_limit` table, migration
0003) because in-memory counters are per isolate; `GET /api/auth-methods` tells the SPA which
sign-in methods exist.
Revision note (2026-09-24, bandwidth guard): The egress proxy is a flat monthly plan with a
bandwidth cap, and the provider stops all proxies past it. With `PROXY_ACCOUNT_API_URL` /
`PROXY_ACCOUNT_API_KEY` set, the 15-minute cron reads the period's usage and cap from the
provider's account API into KV (`proxy:bandwidth`, 1-hour TTL); proxy engines refuse with
`503 engine_unavailable` from 95% until the period ends, logs warn from 80%. A missing, stale
or unreadable snapshot never blocks (fail open). Code: `src/proxy/bandwidth.ts`.
Revision note (2026-09-24): Cost of goods. Both browser engines navigate once
(`domcontentloaded`, then the remaining budget waiting for `networkidle`) instead of
re-navigating after an idle timeout; `proxy-browser` aborts image/media/font requests unless
a screenshot is requested. A page whose `auto` escalation was refused on both tiers
(`EscalationExhaustedError`) is recorded as failed without spending step retries; browser
launch/capacity errors still retry.
Revision note (2026-09-06): Async pages now commit immutable `job_pages` identities, counters, and successful usage atomically in a D1 batch. Immutable R2 attempt archives hold full results and crawl links; KV is a recoverable projection. Authenticated result reads use D1/R2 for marked jobs, so a KV outage cannot hide a committed paid page. Workflow instance ids are persisted before scheduling.

Revision note (2026-08-22): Engine `cf-browser` renamed to `browser`. Proxy secrets are now
provider-neutral: `PROXY_URL` (gateway, e.g. `http://host:port`), `PROXY_USERNAME`,
`PROXY_PASSWORD` replace the former vendor-named username/password pair, and the gateway host
is no longer hardcoded. All three must be present for the proxy engines to be available.
Revision note (2026-08-10): Initial version.

## One Worker, one deployable

`apps/platform` is a single Cloudflare Worker built with Vite:

- **Hono** app: `/api/auth/*` (Better Auth), `/v1/*` (public API), `/api/dashboard/*`
  (session-authenticated dashboard API), Stripe webhook route.
- **React SPA dashboard** served as static assets (Workers Assets) with SPA fallback.
- **create-nodejs-fn** Vite plugin provides `*.container.ts` functions that run in a
  Cloudflare Container (Node.js) — used for proxied fetch and Playwright, because
  Workers `fetch()` cannot use third-party egress proxies and Workers cannot run full
  Playwright.
- **Workflows**: `crawl-workflow` (WorkflowEntrypoint in the same Worker) executes async jobs
  step-by-step (one step per page fetch+convert) so every page benefits from Workflows
  retries for transient failures (4xx and exhausted `auto` escalations are recorded as
  failed pages immediately); terminal failure still writes a `failed` job record (unhappy
  path is explicit).
  Step return values are capped at 1 MiB — steps therefore persist page results to KV/R2
  *inside* the step and return only small summaries (url, status, credits).
- **Browser Run** (formerly Browser Rendering) binding for the `browser` engine, via
  `@cloudflare/playwright`.
- **Security headers**: Worker routes set theirs in a Hono middleware
  (`src/routes/security.ts`); static assets get theirs from `public/_headers` (Workers Assets
  applies it without invoking the Worker, SPA fallback included).

## Bindings

| binding | type | purpose |
|---|---|---|
| `DB` | D1 | users/sessions/api keys (Better Auth), jobs, page commits, usage ledger |
| `JOBS_KV` | KV | job results (TTL), demo quota counters, proxy bandwidth snapshot, ops-alert dedupe markers |
| `ARTIFACTS` | R2 | screenshots, rehosted images, oversized results (lifecycle TTL) |
| `BROWSER` | Browser Rendering | `browser` engine |
| `CRAWL_WORKFLOW` | Workflows | async jobs |
| `NODEJS_FN` | Container/DO | create-nodejs-fn runtime |
| `EMAIL` | Email Sending (`send_email`) | sign-in codes and ops alerts (`OPS_ALERT_EMAIL`), only as `login@webforai.dev` |
| `RATE_LIMIT_FREE` / `RATE_LIMIT_PAID` | Rate Limiting | `/v1` requests per account per minute: 60 / 600 by tier |
| `DEMO_RATE_LIMIT` | Rate Limiting | demo burst cap, 3 per minute per IPv4 / IPv6 /64 |

Secrets: `BETTER_AUTH_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`PROXY_URL`, `PROXY_USERNAME`, `PROXY_PASSWORD`, optional `GITHUB_CLIENT_ID/SECRET`,
optional `PROXY_ACCOUNT_API_URL/KEY`, optional `OPS_ALERT_EMAIL` (var or secret);
`AUTH_PASSWORD_LOGIN` only in local/e2e dev vars.
Typed access via a zod-validated `env.ts` (fail-closed: engines whose secrets are missing are
reported `unavailable`, not silently downgraded).

## Core flow (shared by sync and async)

```
request → auth (api key) → billing guard (subscription/free allowance)
  → acquire HTML (engine) → webforai htmlToMarkdownWithMetadata
  → optional screenshot → R2         (engine capability)
  → optional image rehost → R2 + markdown rewrite
  → usage event (credits) → Stripe meter + D1 ledger   (only on success)
  → result
```

`scrape-core.ts` implements this once; the sync route calls it inline, the Workflow calls it
per URL inside `step.do`. Container functions and Browser Rendering are injected as an
`engines` dependency object so the core is unit-testable without Cloudflare.

## Data model (D1, drizzle)

- Better Auth tables (generated): `user`, `session`, `account`, `verification`, `apikey`,
  + stripe plugin tables (`subscription`).
- `jobs`: id (ULID), userId, type (`batch`|`crawl`), status
  (`queued`|`running`|`completed`|`failed`), request json, counts (total/succeeded/failed),
  creditsUsed, workflowInstanceId, timestamps. Status transitions are monotonic; Workflow
  steps upsert per-page results into KV under `job:<id>:<n>` and update counters — never
  delete-and-reinsert.
- `usage_events`: id (= idempotency key sent to Stripe), userId, jobId?, operation, credits,
  createdAt. Local ledger is the audit source; Stripe meter is billing truth.

## Job results

New jobs persist one `job_pages` marker per `(job_id, page_index)`, referring to an
immutable R2 archive under `results/job-pages/`. The archive is written before the D1
batch. Successful usage, counters, and the marker then commit in one serialized
transaction. Retries first consult the marker, reuse its canonical result, and repair KV;
failed attempts may leave unreferenced R2 objects that expire under the results lifecycle.
A failed marker insert rolls back its preceding accounting writes.

The results API reads marked jobs from D1/R2, ordered by page index. KV remains the legacy
source for jobs without markers. Each marked page expires seven days after its original
commit; reads never renew retention. Missing unexpired archives return a retryable 503.
Archive reads and oversized-result serialization run one page at a time to bound Worker
memory; the returned page holds only inline results or small URL stubs.
Drain old in-flight workflows before upgrading: historical page usage has random ids
and cannot be retrospectively deduplicated. The generated migration and matching Worker
must be deployed together; see the rollout procedure in the 2026-10-01 "moved from README"
revision note above.


- KV `job:<id>:meta` (status snapshot for cheap polling) + `job:<id>:<n>` per-page result,
  TTL 7 days. Results >1 MiB (KV value ceiling 25 MiB, but we cap early) go to R2 with a
  presigned/expiring URL in the KV record.

The Markdown preview renderer is a deferred client chunk. Dashboard/landing startup does
not load it; a local preview error boundary preserves raw Markdown if that chunk fails.

## Repo integration

- New workspace dir `apps/*` added to `pnpm-workspace.yaml`.
- The platform depends on `webforai` via `workspace:*` — the library remains the product,
  the platform is a consumer.
- Existing repo toolchain (biome, vitest, pnpm 9, changesets) is kept; the platform plugs
  into the same scripts. Vite+ / pnpm 10 supply-chain fields are intentionally not adopted
  in this pass (pnpm 9 lockfile compatibility; revisit separately).
