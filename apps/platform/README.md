# webforai platform

A self-hostable crawl→Markdown API on Cloudflare, built on
[webforai](../../packages/webforai). One Worker serves the metered HTTP API (`/v1`), accounts
and API keys (Better Auth), optional Stripe usage-based billing, and a React dashboard. Async
jobs run on Cloudflare Workflows; proxied fetching and Playwright run in a Cloudflare Container
via [create-nodejs-fn](https://github.com/inaridiy/create-nodejs-fn).

Everything here is OSS and runs on your own Cloudflare account. The hosted instance is
`platform.webforai.dev`.

- User docs (API reference, engines, limits, billing): [webforai.dev/platform](https://webforai.dev/platform)
- Design specs (full API contract, architecture, internal RPC for other Workers, billing
  internals): [`docs/specs/platform/`](../../docs/specs/platform/)
- Clients: the `webforai/platform` TypeScript client (a subpath of the
  [`webforai`](../../packages/webforai) package) and the CLI ([`webforai-cli`](../../packages/cli): `npx webforai-cli <url> --engine auto`).

## Requirements

- **Cloudflare Workers Paid plan.** Containers, Workflows and Browser Run (the `browser`
  binding) are not available on the free plan.
- **A domain onboarded to Cloudflare Email Sending.** Sign-in is by emailed 6-digit code;
  there is no password login in production.
- **Node 20+, pnpm 9, Docker.** Docker must be running for `pnpm dev`, `pnpm build` and
  `pnpm run deploy`: each builds the container image.
- Optional: a Stripe account (paid plans; without it everyone gets the free monthly
  allowance), an HTTP rotating-proxy gateway (enables the `proxy-*` engines and
  `region: "jp"`), a GitHub OAuth app (GitHub login), Cloudflare Turnstile (bot check on
  sign-in).

## API in one minute

```bash
# Markdown from a URL (sync). Default engine "auto": plain fetch, escalated to browser
# rendering when the page is a client-side shell (1 or 2 credits).
curl -X POST https://<your-host>/v1/scrape \
  -H "Authorization: Bearer wfa_..." -H "content-type: application/json" \
  -d '{ "url": "https://example.com/article" }'

# Rendered in a real browser, with a screenshot (2+1 credits)
curl -X POST https://<your-host>/v1/scrape \
  -H "Authorization: Bearer wfa_..." -H "content-type: application/json" \
  -d '{ "url": "https://example.com", "engine": "browser", "screenshot": true }'

# Async jobs (results kept 7 days)
curl -X POST https://<your-host>/v1/batch \
  -H "Authorization: Bearer wfa_..." -H "content-type: application/json" \
  -d '{ "urls": ["https://example.com/a", "https://example.com/b"] }'
curl -X POST https://<your-host>/v1/crawl \
  -H "Authorization: Bearer wfa_..." -H "content-type: application/json" \
  -d '{ "url": "https://docs.example.com", "maxDepth": 2, "limit": 50 }'
curl -H "Authorization: Bearer wfa_..." https://<your-host>/v1/jobs/<jobId>          # status
curl -H "Authorization: Bearer wfa_..." https://<your-host>/v1/jobs/<jobId>/results  # paged results

# Keyless demo (unbilled, rate limited, truncated) and Markdown permalinks
curl -X POST https://<your-host>/v1/demo/scrape \
  -H "content-type: application/json" -d '{ "url": "https://example.com" }'
curl https://<your-host>/https://example.com/article
```

Engines: `auto` (default), `fetch`, `browser`, `proxy-fetch`, `proxy-browser`. Parameters,
limits, error codes and pricing are documented at
[webforai.dev/platform](https://webforai.dev/platform); the full contract is
[`docs/specs/platform/03_api.md`](../../docs/specs/platform/03_api.md).

## Deploying your own instance

Run these from `apps/platform` after `pnpm install` at the repo root.

1. **Email.** Onboard your domain to Cloudflare Email Sending
   (`wrangler email sending enable <domain>`), then set your sender address in
   `wrangler.jsonc` (`send_email[0].allowed_sender_addresses`) and in
   `src/auth/sign-in-email.ts` (`SIGN_IN_SENDER`). See [Make it yours](#make-it-yours) for
   the rest of the operator identity.
2. **Resources.** `wrangler d1 create platform`, `wrangler kv namespace create JOBS_KV`,
   `wrangler r2 bucket create webforai-platform-artifacts`, and put the ids into
   `wrangler.jsonc`. Rate-limit `namespace_id`s in `wrangler.jsonc` must be unique in your
   account; change them if they collide with other Workers.
3. **Host.** Replace the `routes` entry and the `BASE_URL` var in `wrangler.jsonc` with your
   host.
4. **Database.** `pnpm db:migrate:remote`. Run it again before every deploy that ships new
   migrations, so the schema is in place before the code that uses it.
5. **Billing (optional).** `STRIPE_SECRET_KEY=sk_... pnpm stripe:setup` creates the meter and
   price and prints the price id. Point a Stripe webhook at
   `https://<host>/api/auth/stripe/webhook`.
6. **Secrets.** `wrangler secret put <NAME>` for each secret you need from the
   [table below](#secrets-and-optional-features).
7. **Artifact expiry.** `wrangler r2 bucket lifecycle add webforai-platform-artifacts` with
   prefix rules for `screenshots/`, `images/` and `results/` (e.g. expire after 7 days).
8. **Deploy.** `pnpm run deploy` (`run` is required: bare `pnpm deploy` is a pnpm built-in).

If you update an existing instance, drain in-flight async jobs before deploying a release
whose notes say so, and re-put any secret whose name changed.

### Secrets and optional features

Set these with `wrangler secret put` in production and in `.dev.vars` (gitignored) locally.
A missing optional secret disables its feature explicitly: proxy engines answer
`503 engine_unavailable`, and billing runs in free-allowance-only mode.

| name | required? | enables |
|---|---|---|
| `BETTER_AUTH_SECRET` | yes (≥ 32 chars) | sessions and auth |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_METERED_PRICE_ID` | optional, all three | paid plans and metered billing |
| `PROXY_URL`, `PROXY_USERNAME`, `PROXY_PASSWORD` | optional, all three | `proxy-fetch`, `proxy-browser`, `region: "jp"`. `PROXY_URL` is any HTTP rotating-proxy gateway, e.g. `http://host:port` |
| `PROXY_ACCOUNT_API_URL`, `PROXY_ACCOUNT_API_KEY` | optional | monthly proxy bandwidth guard: the 15-minute cron logs from 80% and refuses proxy engines from 95% until the period renews |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | optional | GitHub login (OAuth callback `<BASE_URL>/api/auth/callback/github`) |
| `TURNSTILE_SECRET_KEY` | optional (pairs with the `TURNSTILE_SITE_KEY` var) | Turnstile check when sending sign-in codes. With a site key on a production `BASE_URL` but no secret, sign-in refuses (500) rather than running unchecked; remove the site key if you do not use Turnstile |
| `OPS_ALERT_EMAIL` | optional (secret or var) | email alerts for proxy bandwidth at 80% / 95% and failed cron passes; unset = logged only |
| `AUTH_PASSWORD_LOGIN=true` | local/e2e only, **never in production** | email + password sign-up for seeding |

Alerts and sign-in codes go out through the `EMAIL` binding. If you restrict its
destinations (`allowed_destination_addresses`), include `OPS_ALERT_EMAIL`, and remember that
sign-in codes go to every user.

### Make it yours

The repo ships with the hosted instance's identity. Replace it before going live:

- Sender address `login@webforai.dev`: `wrangler.jsonc` (`send_email`) and
  `src/auth/sign-in-email.ts` (`SIGN_IN_SENDER`).
- Host `platform.webforai.dev`: `wrangler.jsonc` (`routes`, `BASE_URL`),
  `src/client/lib/links.ts` (`CANONICAL_ORIGIN`), `index.html` (canonical, `og:url`,
  `og:image`), `public/robots.txt`, `public/sitemap.xml`.
- Turnstile site key: `wrangler.jsonc` (`TURNSTILE_SITE_KEY`).
- Contact address `support@webforai.dev`: `src/client/components/site-shell.tsx` (footer).
- Legal pages (terms, privacy policy, and the Japanese commercial-transactions disclosure
  required for paid services in Japan): `src/client/pages/legal/terms-content.tsx`,
  `privacy-content.tsx`, `commerce-content.tsx`. These name the operator, host and contact
  address; rewrite them for your own service.
- Prices: `src/billing/credits.ts` (see [Changing prices](#changing-prices)).

## Local development

```bash
pnpm install              # repo root
cd apps/platform
pnpm db:migrate:local     # apply migrations to local D1
pnpm dev                  # Vite dev server; first run builds the container image (Docker)
```

Put at least `BETTER_AUTH_SECRET` in `.dev.vars`. The `browser` engine needs a real Browser
Run session (`wrangler dev --remote` semantics); the other engines work fully locally.

Sign-in codes are not delivered locally: the dev server logs the email and saves it under
the Miniflare temp directory, so read the code there (or set `"remote": true` on the `EMAIL`
binding to send real mail).

Walkthrough: open http://localhost:5173, sign in with any email (code from the dev server
log), create an API key on the dashboard, then

```bash
curl -X POST http://localhost:5173/v1/scrape \
  -H "Authorization: Bearer <key>" -H "content-type: application/json" \
  -d '{"url":"https://example.com"}'
```

and watch usage appear on the dashboard.

If you change the inline script in `scripts/prerender.ts`, update its sha256 in the CSP in
`public/_headers`; a unit test fails until the two match.

## Commands

| command | purpose |
|---|---|
| `pnpm dev` | Vite dev server (Worker + SPA + container) |
| `pnpm test` | unit tests (pure logic; no network or Docker) |
| `pnpm test:browser` | Chromium dashboard UI regression with HTTP fixtures; screenshots in `.cache/dashboard-review` |
| `pnpm test:integration` | against a disposable local D1 with the checked-in migrations (page accounting, email-code sign-in, account deletion, billing, limits) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | builds the `webforai` library, then the Worker, client assets and container image, then prerenders `/` and the legal pages (`scripts/prerender.ts`) |
| `pnpm db:generate` | drizzle-kit migration from `src/db/schema.ts` |
| `pnpm db:migrate:local` / `pnpm db:migrate:remote` | apply migrations to D1 |
| `pnpm stripe:setup` | create the Stripe meter and metered price (prints ids) |
| `pnpm cf-typegen` | regenerate `worker-configuration.d.ts` |
| `pnpm run deploy` | build + `wrangler deploy` |

## Billing

One Stripe Billing Meter counts credits. Credits per operation and the price tiers live in
`src/billing/credits.ts`; the landing page and dashboard render prices from that file. Without
a subscription an account gets 1,000 credits/month free. Proxy engines need an active
subscription, and subscribers have a monthly spend cap they set in the dashboard. Usage is
recorded in D1 and mirrored to Stripe by the request and by a 15-minute retry cron. Details:
[`docs/specs/platform/04_billing.md`](../../docs/specs/platform/04_billing.md).

### Changing prices

Stripe prices are immutable, so a new schedule is a new price under a versioned lookup key
(`PRICE_LOOKUP_KEY` in `scripts/stripe-setup.ts`):

1. Edit `ENGINE_CREDITS` / `FREE_MONTHLY_CREDITS` / `PRICE_TIERS` in `src/billing/credits.ts`
   (and bump the lookup key if the tiers changed); update `docs/specs/platform/04_billing.md`.
2. `STRIPE_SECRET_KEY=sk_... pnpm stripe:setup` creates the new price and prints its id; it
   also lists older prices that are still active.
3. `wrangler secret put STRIPE_METERED_PRICE_ID` with the new id, then `pnpm run deploy`.
   New checkouts use the new price; credit counts per operation change for everyone at deploy.
4. Move existing subscriptions to the new price at their next period boundary (Stripe
   Dashboard → subscription → update, or subscription schedules). Until moved they pay the
   old per-credit rate on the new credit counts. Archive the old price once no subscription
   uses it.

## Operations

- A usage row Stripe refuses for good (e.g. an unknown customer after switching from test to
  live keys) is logged as `usage_report_rejected` and set aside. Clear its
  `usage_events.report_skipped_reason` within 35 days to re-send it.
- `503 scheduling_unknown` on job creation means the acknowledgement was lost, not
  necessarily the job: inspect the job id from the error and its Workflow instance before
  submitting a replacement.
