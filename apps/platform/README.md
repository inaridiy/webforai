# webforai platform

Crawl→Markdown SaaS on Cloudflare, built on [webforai](../../packages/webforai). One Worker
serves the metered HTTP API (`/v1`), the Better Auth accounts + API keys, the Stripe
usage-based billing, and the React dashboard. Async jobs run on Cloudflare Workflows;
proxied fetching and Playwright run in a Cloudflare Container via
[create-nodejs-fn](https://github.com/inaridiy/create-nodejs-fn).

Design ledger: [`docs/specs/platform/`](../../docs/specs/platform/) (scope, architecture,
API, billing). User documentation lives on the docs site:
[webforai.dev/platform](https://webforai.dev/platform) (overview, API reference, billing) —
the SPA intentionally has no docs page of its own. Everything here is OSS and self-hostable
on your own Cloudflare account. Official clients: the `webforai/platform` TypeScript
client (a subpath of the [`webforai`](../../packages/webforai) package) and the `webforai`
CLI (`npx webforai <url> --engine auto`).

## API in one minute

```bash
# Markdown from a URL (sync; default engine "auto" — plain fetch, escalated to browser
# rendering when the page turns out to be a client-side shell — 1 or 2 credits)
curl -X POST https://<your-host>/v1/scrape \
  -H "Authorization: Bearer wfa_..." -H "content-type: application/json" \
  -d '{ "url": "https://example.com/article" }'

# Rendered in a real browser with screenshot (2+1 credits)
curl -X POST https://<your-host>/v1/scrape \
  -d '{ "url": "https://example.com", "engine": "browser", "screenshot": true }' ...

# Async jobs (Workflows; results retained 7 days)
curl -X POST https://<your-host>/v1/batch -d '{ "urls": ["https://a", "https://b"] }' ...
curl -X POST https://<your-host>/v1/crawl -d '{ "url": "https://docs.example.com", "maxDepth": 2, "limit": 50 }' ...
curl https://<your-host>/v1/jobs/<jobId>          # status
curl https://<your-host>/v1/jobs/<jobId>/results  # paged results
```

Engines: `auto` (default — cheapest first, escalates to browser rendering on
client-rendered shells, bills the engine that ran, 1–2 credits), `fetch` (Workers fetch,
1 credit), `browser` (Browser Run rendering, 2, screenshots), `proxy-fetch` (rotating proxy
via container, 2), `proxy-browser` (Playwright behind the proxy in container, 3,
screenshots). Fetch-tier engines follow `<meta http-equiv="refresh">` redirect stubs like
HTTP redirects (≤ 3 hops, SSRF-guarded, one operation). Responses carry a `warning` when a
fetch-tier result looks like an unrendered shell. `rehostImages: true` re-uploads the page's raster images (png, jpeg,
gif, webp, avif, bmp, ico, tiff — never SVG) to R2 behind expiring signed URLs; `/artifacts/*` serves them under a
sandboxing CSP with `nosniff`, and downloads anything else as an attachment.
Every engine checks each HTTP redirect hop against the SSRF guard before requesting it (≤ 10 hops), and the browser
engines abort requests to private addresses. Limits: URLs ≤ 2,048 characters, `/v1` and `/api` request bodies
≤ 256 KiB (`413 payload_too_large`), crawl `includePaths`/`excludePaths` ≤ 20 regexes of ≤ 200 characters with
backtracking-prone shapes such as `(a+)+` refused. State-changing `/api/dashboard/*` calls must send an `Origin` equal
to `BASE_URL`'s origin (`403 forbidden_origin`). The SPA's security headers (CSP, HSTS, frame denial) are in
`public/_headers`; if you change the inline script in `scripts/prerender.ts`, update its sha256 there
(`src/routes/spa-headers.test.ts` fails until you do).
`"region": "jp"` pins proxy egress to Japanese IPs (`auto` by
default; pins `engine: "auto"` to the proxy tier, ignored by the two non-proxy engines).
`"respectRobotsTxt"` (default `false` for scrape/batch, `true` for crawl) honors the target site's robots.txt
rules for the `webforai-platform` token: each URL is checked before any engine runs and a
disallowed one fails with `403 robots_disallowed`, unbilled. robots.txt fetches go through
Cloudflare's edge cache (1h); an unavailable robots.txt (4xx, 5xx, timeout) means no rules.
Full contract: `docs/specs/platform/03_api.md`.

`POST /v1/demo/scrape` is a public, keyless, unbilled demo (fixed `auto` engine, markdown
cut near 40,000 chars at a paragraph boundary with an in-markdown notice) behind both the
docs-site demo and the platform landing's hero (raw Markdown + rendered preview side by side; the response names the
engine `auto` resolved to, which both demos display; identical URL + region requests are
served from a 10-minute cache without counting), limited per client (IPv4 address or IPv6
/64) to 3 requests / minute (`DEMO_RATE_LIMIT` binding) and 5 / 10 min (KV window), and to
500 / day globally (KV counter; the KV counters are approximate under concurrency):

```bash
curl -X POST https://<your-host>/v1/demo/scrape \
  -H 'content-type: application/json' -d '{ "url": "https://example.com" }'
```

The demo answers `402 payment_required` for `"region": "jp"` (proxy egress is paid-only).

**Markdown permalinks.** `GET /https://example.com/page` returns the page as `text/markdown`
(`routes/permalink.ts`; the paths are in `run_worker_first`). Without a key it is the demo
(same limits, cache and truncation); with `Authorization: Bearer wfa_...` it is a billed
`POST /v1/scrape` with the `auto` engine. The target's query string is part of the target.
Errors come back as one `code: message` line with the original status (and `Retry-After`):

```bash
curl https://<your-host>/https://example.com/article
curl -H "Authorization: Bearer wfa_..." https://<your-host>/https://example.com/article
```

### Limits

| limit | free | paid (active subscription) | over the limit |
|---|---|---|---|
| `/v1` requests per minute, per account (all keys together; `GET /v1/jobs/*` not counted) | 60 | 600 | `429 rate_limited` + `Retry-After: 60` |
| batch/crawl jobs (async scrape included) queued or running at once (silent > 1h: not counted) | 3 | 20 | `429 too_many_jobs` |
| API keys per account | 50 | 50 | `403` on key creation |

The request limits use Workers Rate Limiting bindings (`RATE_LIMIT_FREE`, `RATE_LIMIT_PAID`,
`DEMO_RATE_LIMIT` in `wrangler.jsonc`, keyed by user id / client IP). Their counters are per
Cloudflare location and eventually consistent — a cost bound, not exact accounting. A
deployment without the bindings runs unlimited and logs `rate_limit_binding_missing` once;
a failing binding lets `/v1` through but denies the demo. Constants: `src/ops/limits.ts`.

## Internal RPC (`PlatformRpc`)

Other Workers on the same Cloudflare account can call the converter directly through a Service
Binding — no API key, tier limit, spend guard, usage ledger or Stripe (the binding is the
credential). The SSRF guard and redirect walk, Browser Run's shared concurrency and a
per-tenant safety limit (`RATE_LIMIT_INTERNAL`, 300/min) still apply; proxy engines are not
offered. Code: `src/rpc/convert.ts`, entrypoint class in `src/index.ts`.

```jsonc
// caller's wrangler.jsonc
"services": [{ "binding": "WEBFORAI", "service": "webforai-platform", "entrypoint": "PlatformRpc" }]
```

```ts
const page = await env.WEBFORAI.convert("https://ui.example.com/docs/installation", {
  tenant: "shadcn-explorer",          // required: logs and the per-tenant limit
  formats: ["markdown", "links"],     // default ["markdown"]; "links" = every http(s) link on the page
  extractor: "auto",                  // auto | takumi | minimal | none ("none" keeps everything)
  engine: "auto",                     // auto | fetch | browser
});
// → { url, markdown, links?, metadata?, engine, warning? }
```

Errors arrive as `Error`s whose message starts with a code (`invalid_request: …`,
`invalid_url: …`, `rate_limited: …`, `fetch_failed: …`) — Workers RPC keeps only the message.

## Local development

Prereqs: Node 20+, pnpm 9, Docker (for the container engines).

```bash
pnpm install                                  # repo root
cd apps/platform
pnpm db:migrate:local                         # apply drizzle migrations to local D1
pnpm dev                                      # vite dev (first run builds the container image)
```

- `.dev.vars` (gitignored) supplies secrets locally:
  `BETTER_AUTH_SECRET` (required, ≥32 chars), `PROXY_URL`/`PROXY_USERNAME`/`PROXY_PASSWORD`
  (an HTTP rotating-proxy gateway, e.g. `PROXY_URL=http://host:port` — enables the proxy
  engines), `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_METERED_PRICE_ID`
  (enables billing), `GITHUB_CLIENT_ID`/`_SECRET` (enables GitHub login; OAuth app callback
  `<BASE_URL>/api/auth/callback/github`), `AUTH_PASSWORD_LOGIN=true` (local/e2e only:
  email + password sign-up for seeding — never set in production),
  `PROXY_ACCOUNT_API_URL`/`PROXY_ACCOUNT_API_KEY` (the proxy provider's v2 account API base
  and key — enables the monthly bandwidth guard: the 15-minute cron stores usage in KV, logs
  `proxy_bandwidth_high` from 80%, and from 95% the proxy engines answer
  `503 engine_unavailable` until the provider's period renews),
  `OPS_ALERT_EMAIL` (operator address for ops alerts — proxy bandwidth crossing 80% / 95%,
  once per threshold per period; a failed cron pass, at most hourly — sent through the
  `EMAIL` binding as `login@webforai.dev`; unset = alerts are only logged).
  Missing optional secrets degrade explicitly: proxy engines return
  `503 engine_unavailable`, billing runs in free-allowance-only mode.
- `browser` needs a real Browser Run session (`wrangler dev --remote` semantics); the
  other three engines work fully locally.

Sign-in is by emailed 6-digit code (Better Auth email OTP, sent through the `EMAIL`
`send_email` binding as `login@webforai.dev`). Locally the email is not delivered: the dev
server logs it and saves it under the Miniflare temp directory, so read the code there (or set
`"remote": true` on the binding to send real mail). Code sends are rate limited per IP in D1
(`rate_limit` table, 3 per minute), and each address receives at most 5 code emails per hour
(`JOBS_KV`, keyed by a SHA-256 of the address; further requests answer 200 without mailing). Asking again within the 10-minute validity re-sends the
same code (stored encrypted), so every email the user received works. With
`TURNSTILE_SITE_KEY` (var) and `TURNSTILE_SECRET_KEY` (secret) set, sending a code also
requires a Cloudflare Turnstile token (Better Auth captcha plugin; action `sign-in`, hostname
from `BASE_URL`), as do the plugin's password-reset OTP endpoints
(`/email-otp/request-password-reset`, `/forget-password/email-otp`). Only sign-in codes are
ever emailed; other OTP types are dropped (`otp_email_suppressed` in the logs). A production
`BASE_URL` (https, not localhost) with the site key but no secret refuses those paths (500,
`turnstile_secret_missing` in the logs) instead of running without the bot check. OAuth failures such as `account_not_linked` return to `/login?error=…` —
an existing email account must sign in by code once (which verifies its email) before
GitHub can link to it.

Manual walkthrough: open http://localhost:5173, sign in with any email (read the code from the
dev server log), create an API key on the dashboard, then `curl -X POST localhost:5173/v1/scrape -H "Authorization: Bearer <key>"
-d '{"url":"https://example.com"}'` and watch usage appear on the dashboard.

## Commands

| command | purpose |
|---|---|
| `pnpm dev` | vite dev server (Worker + SPA + container) |
| `pnpm test` | vitest unit tests (pure logic; no network/Docker) |
| `pnpm test:browser` | Chromium dashboard UI regression with HTTP fixtures; desktop/mobile screenshots in `.cache/dashboard-review` (no real auth/Worker) |
| `pnpm test:integration` | against disposable local workerd D1 with the checked-in migrations: the page-accounting repository (duplicate writes, rollback) and the real Better Auth email-code sign-in (hashed codes, wrong/replayed codes, D1 rate limit, passwords off) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | builds the `webforai` library first (the platform imports its `dist`), then the production build (Worker + client assets + container image), then prerenders `/` into `dist/client/index.html` and the legal pages into `dist/client/{terms,privacy,commerce}.html` (each with its own title, description, canonical and `og:url`), and fails if webforai cannot extract any of them (`scripts/prerender.ts`) |
| `pnpm db:generate` | drizzle-kit migration from `src/db/schema.ts` |
| `pnpm db:migrate:local` / `:remote` | apply migrations to D1 |
| `pnpm stripe:setup` | create Stripe meter + metered price (prints ids) |
| `pnpm cf-typegen` | regenerate `worker-configuration.d.ts` |
| `pnpm run deploy` | build + `wrangler deploy` (`run` is required — bare `pnpm deploy` is pnpm's own command) |

## Deploying your own instance

0. Sign-in email: onboard your domain to Cloudflare Email Sending
   (`wrangler email sending enable <domain>`) and change the sender in `wrangler.jsonc`
   (`allowed_sender_addresses`) and `src/auth/sign-in-email.ts` (`SIGN_IN_SENDER`).
1. `wrangler d1 create platform`, `wrangler kv namespace create JOBS_KV`,
   `wrangler r2 bucket create webforai-platform-artifacts` — put the ids into
   `wrangler.jsonc`.
2. `pnpm db:migrate:remote`.
3. Billing (optional): `STRIPE_SECRET_KEY=sk_... pnpm stripe:setup`, then point a Stripe
   webhook at `https://<host>/api/auth/stripe/webhook`.
4. Secrets: `wrangler secret put` each secret listed above (proxy engines need `PROXY_URL`,
   `PROXY_USERNAME` and `PROXY_PASSWORD` — any HTTP rotating-proxy gateway works; instances
   deployed before 2026-08-22 must re-put these under the new names); set `BASE_URL` var to
   your host.
5. R2 lifecycle (artifact TTL): `wrangler r2 bucket lifecycle add webforai-platform-artifacts`
   with prefix rules for `screenshots/`, `images/`, `results/` (e.g. expire after 7 days).
6. Ops alerts (optional): `wrangler secret put OPS_ALERT_EMAIL` (or a var). The `EMAIL`
   binding has no destination restriction, so any address works once the sending domain is
   onboarded; if you restrict it with `allowed_destination_addresses` /
   `destination_address`, include this address (and remember sign-in codes go to every user).
   Rate-limit `namespace_id`s in `wrangler.jsonc` must be unique in your account.
7. `pnpm run deploy` (Workers Paid plan needed for Containers/Workflows/Browser Run).

## Billing model

Single Stripe Billing Meter denominated in credits; the schedule and price tiers live in
`src/billing/credits.ts` (`fetch` 1, `browser` 2, `proxy-fetch` 2, `proxy-browser` 3,
+1 screenshot, +1 per started 5 rehosted images; `PRICE_TIERS`). 1,000 credits/month free
without a subscription; the metered subscription uses graduated tiers per calendar month —
first 1,000 at $0, then $0.001, $0.0007 above 100k and $0.0005 above 1M credits. The landing
page and dashboard render prices from the same file. Usage is recorded in D1
(`usage_events`, ULID for sync requests or a deterministic job/page id) and mirrored to Stripe meter events with that id as the
idempotency `identifier` and the usage time as `timestamp`; unreported rows are retried by a
15-minute cron (up to 10 pages of 100 per run) through a partial index. Rows that can never be
billed leave that queue with `report_skipped_reason` set: `no_customer` (free usage of an
account without a Stripe customer), `expired` (older than Stripe's 35-day meter window,
logged as `usage_report_expired`) or `rejected` (Stripe refused the event for good, e.g. an
unknown customer after a test→live key switch; logged as `usage_report_rejected` — clear the
column within 35 days to re-send). A "duplicate identifier" answer counts as reported; rate
limits, 5xx and key/meter configuration errors stay queued. Migration `0004` adds that
column, the replacement index and `billing_state.spend_cap_usd`; apply it with `pnpm db:migrate:remote` **before** deploying.

Proxy engines (`proxy-fetch`, `proxy-browser`, or `auto` with a region such as `jp`) need an
active subscription (`402 payment_required`); the keyless demo refuses non-`auto` regions.
Subscribers have a monthly spend cap — default $50, settable from $1 to $5,000 in the
dashboard (`GET`/`PUT /api/dashboard/billing/spend-cap`) — and get `402 spend_cap_reached`
once one more credit would push this UTC month's estimate past it. Checkout refuses a second
subscription (`409 already_subscribed`) and anchors billing periods to the 1st of the month
(00:00 UTC), so Stripe's tiers reset with the dashboard's calendar month.

### Changing prices

Stripe prices are immutable, so a new schedule is a new price under a versioned lookup key
(`PRICE_LOOKUP_KEY` in `scripts/stripe-setup.ts`, currently `webforai_platform_credits_v2`):

1. Edit `ENGINE_CREDITS` / `FREE_MONTHLY_CREDITS` / `PRICE_TIERS` (and bump the lookup key if
   the tiers changed); update `docs/specs/platform/04_billing.md`.
2. `STRIPE_SECRET_KEY=sk_... pnpm stripe:setup` creates the new price and prints its id; it
   also lists older prices that are still active.
3. `wrangler secret put STRIPE_METERED_PRICE_ID` with the new id, then `pnpm run deploy`.
   New checkouts use the new price; credit counts per operation change for everyone at deploy.
4. Move existing subscriptions to the new price at their next period boundary (Stripe
   Dashboard → subscription → update, or subscription schedules). Until moved they pay the
   old per-credit rate on the new credit counts (for the 2026-09-24 change every engine is
   still cheaper than before on v1, e.g. `browser` $0.004 instead of $0.01). Archive the old
   price once no subscription uses it.

## Dashboard and job reliability

The dashboard opens with a "Get set up" checklist (create a key → send a first request →
optional billing) that disappears once the account has a key and usage, then one usage panel:
credits used this month, the estimated bill from `PRICE_TIERS`, and the plan with its billing
actions. Below the API keys, a "Use your key" card shows the same request for curl, the TypeScript
client and the CLI (with `baseUrl` / `WEBFORAI_PLATFORM_URL` filled in on self-hosted
origins) and links to the platform docs. The header's "Docs" link opens the *platform*
docs (webforai.dev/platform); the footer links library, CLI, client and self-hosting docs.
The URLs live in `src/client/lib/links.ts`.

Accounts can be deleted from the dashboard (`POST /api/dashboard/account/delete` with
`{ confirmEmail }`): queued/running job Workflows are terminated first (best-effort), then
unreported usage is sent to the Stripe meter and an active subscription is cancelled with an
immediate final invoice — if either fails, nothing is deleted — and then the user's keys, jobs, usage, billing state, pending codes, sessions, linked accounts and user
row go in one D1 batch; job archives in R2 are removed best-effort, paging past 1,000 objects
(the 7-day lifecycle catches the rest). Stripe keeps its invoices.

Legal pages are SPA routes: `/terms`, `/privacy`, `/commerce` (特定商取引法に基づく表記),
linked from the footer with `support@webforai.dev`; the sign-in page states that continuing
means agreeing to the Terms and the Privacy Policy, and links both. `pnpm build` also writes
them as static files (`terms.html`, …), which Workers static assets serve at `/terms` under
the default `html_handling` (`auto-trailing-slash`), so crawlers read real content and
per-page metadata (`src/client/lib/page-meta.ts`, which also sets `document.title` in the
SPA). Every other path still falls back to the prerendered `index.html`. `public/` holds
`og.png` (Open Graph image, tags in `index.html` with the canonical link and a
`SoftwareApplication` JSON-LD block), `robots.txt` (points to `sitemap.xml`), `sitemap.xml`
(`/` and the three legal pages), and the installable-app files below.

### Installable app (PWA) and offline data

The SPA is an installable PWA: `public/manifest.webmanifest` (starts on `/dashboard`),
`public/icons/`, and `public/sw.js`. The dashboard's **Settings → Install the app** card has
per-platform install steps (iOS Safari: Share → Add to Home Screen; Android Chrome: ⋮ →
Install app; desktop Chrome/Edge: address-bar install icon), plus the browser's own install
button when one is offered. The service worker is registered only in production builds
(`pnpm build`), never under `pnpm dev`. To exercise it locally, serve the build with
`pnpm build && pnpm exec vite preview`. Like `pnpm dev`, this builds the container image
first, so Docker must be running.

- The service worker loads page navigations network-first and falls back to the cached app
  shell when the device is offline or the network stalls for more than 4 s. It serves the
  hashed `/assets/*` cache-first and other static files stale-while-revalidate. It never
  intercepts `/v1`, `/api`, `/artifacts`, `/health` or cross-origin requests.
- Dashboard data (the signed-in account's id, email and name; usage; the key list without
  secrets; jobs) is saved in `localStorage` under `wfa-cache:v1:*`
  (`src/client/lib/local-cache.ts`). On reopen it is shown while fresh data loads, and it is
  kept with a "Showing saved data" notice when a load fails offline or with a 5xx. Sign-out,
  an expired session, account deletion and **Clear saved data** remove it.
- Share target: the manifest's `share_target` (GET `/share?url=&text=&title=`) puts the app in
  the OS share sheet. `/share` takes the first http(s) URL from `url`, else `text`, and opens
  the playground (signed in) or the landing demo (signed out) with it prefilled via `?url=`;
  nothing runs until Run/Convert is pressed. The navigation goes through the normal
  network-first shell, so it also works offline.
- The prerendered legal pages are served on navigation but never stored as the offline shell
  (`OWN_DOCUMENT` in `sw.js`); offline, the shell renders them client-side.
- The shell uses `min-h-dvh` (100dvh, not 100vh) and safe-area insets
  (`viewport-fit=cover`). Text fields are 16px on phones so iOS does not zoom on focus.

The dashboard distinguishes empty jobs from failed requests and provides Retry. Usage and
job responses are validated before rendering. Authentication outages keep the dashboard
open with a retry action. Navigation wraps on small screens; API key copy failures provide
manual-copy guidance, and each newly created key starts with fresh copy feedback. The
Markdown renderer loads when a result is displayed; raw output stays usable if preview
loading fails.

Async pages use an immutable D1 `job_pages` record and R2 result archive. A D1 batch commits
the page marker, counters, and successful usage together, once per job/page index. Replays
reuse the committed result and repair its KV projection; they do not fetch or bill again.
KV visibility can temporarily lag committed D1 counts; result reads use D1/R2 for marked
jobs and return `503 result_unavailable` if an unexpired archive cannot be read. Uncommitted R2 attempts expire under
the existing `results/` lifecycle rule.

Before upgrading an existing instance to the page-accounting migration, stop accepting new
async jobs and let old workflows finish. Historical in-flight pages lack stable accounting
identities and cannot be safely deduplicated retroactively. Apply generated migration
`0001_wild_miek.sql`, deploy the matching Worker, then resume job creation. Do not roll back
to the old accounting code while new jobs are active. No production migration is run by tests.

If scheduling returns `503 scheduling_unknown`, use the job id in the error to inspect its
status and Workflow instance before submitting a replacement. The scheduling request may
have been accepted even though the acknowledgement was lost; its queued record is retained
for operator reconciliation.
