# Platform Architecture

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

## Bindings

| binding | type | purpose |
|---|---|---|
| `DB` | D1 | users/sessions/api keys (Better Auth), jobs, page commits, usage ledger |
| `JOBS_KV` | KV | job results (TTL), rate/quota counters |
| `ARTIFACTS` | R2 | screenshots, rehosted images, oversized results (lifecycle TTL) |
| `BROWSER` | Browser Rendering | `browser` engine |
| `CRAWL_WORKFLOW` | Workflows | async jobs |
| `NODEJS_FN` | Container/DO | create-nodejs-fn runtime |
| `EMAIL` | Email Sending (`send_email`) | sign-in codes, only as `login@webforai.dev` |

Secrets: `BETTER_AUTH_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`PROXY_URL`, `PROXY_USERNAME`, `PROXY_PASSWORD`, optional `GITHUB_CLIENT_ID/SECRET`,
optional `PROXY_ACCOUNT_API_URL/KEY`; `AUTH_PASSWORD_LOGIN` only in local/e2e dev vars.
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
must be deployed together; see the platform README rollout procedure.


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
