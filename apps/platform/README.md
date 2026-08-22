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
on your own Cloudflare account. Official clients: the
[`@webforai/platform`](../../packages/platform) TypeScript client and the `webforai` CLI
(`npx webforai <url> --engine browser`).

## API in one minute

```bash
# Markdown from a URL (sync, plain Workers fetch — 1 credit)
curl -X POST https://<your-host>/v1/scrape \
  -H "Authorization: Bearer wfa_..." -H "content-type: application/json" \
  -d '{ "url": "https://example.com/article" }'

# Rendered in a real browser with screenshot (5+1 credits)
curl -X POST https://<your-host>/v1/scrape \
  -d '{ "url": "https://example.com", "engine": "browser", "screenshot": true }' ...

# Async jobs (Workflows; results retained 7 days)
curl -X POST https://<your-host>/v1/batch -d '{ "urls": ["https://a", "https://b"] }' ...
curl -X POST https://<your-host>/v1/crawl -d '{ "url": "https://docs.example.com", "maxDepth": 2, "limit": 50 }' ...
curl https://<your-host>/v1/jobs/<jobId>          # status
curl https://<your-host>/v1/jobs/<jobId>/results  # paged results
```

Engines: `fetch` (Workers fetch, 1 credit), `browser` (Browser Run rendering, 5,
screenshots), `proxy-fetch` (rotating proxy via container, 2), `proxy-browser`
(Playwright behind the proxy in container, 5, screenshots). `rehostImages: true` re-uploads the
page's images to R2 behind expiring signed URLs. `"region": "us" | "eu" | "uk" | "jp" | "asia"`
picks the proxy egress country (`auto` by default; ignored by the two non-proxy engines).
Full contract: `docs/specs/platform/03_api.md`.

`POST /v1/demo/scrape` is a public, keyless, unbilled demo (fixed `proxy-fetch`, markdown
truncated to 8000 chars) for the docs site, limited to 5 requests / 10 min per IP and 500 / day
globally:

```bash
curl -X POST https://<your-host>/v1/demo/scrape \
  -H 'content-type: application/json' -d '{ "url": "https://example.com", "region": "us" }'
```

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
  (enables billing), `GITHUB_CLIENT_ID`/`_SECRET` (enables GitHub login).
  Missing optional secrets degrade explicitly: proxy engines return
  `503 engine_unavailable`, billing runs in free-allowance-only mode.
- `browser` needs a real Browser Run session (`wrangler dev --remote` semantics); the
  other three engines work fully locally.

Manual walkthrough: open http://localhost:5173, sign up, create an API key on the
dashboard, then `curl -X POST localhost:5173/v1/scrape -H "Authorization: Bearer <key>"
-d '{"url":"https://example.com"}'` and watch usage appear on the dashboard.

## Commands

| command | purpose |
|---|---|
| `pnpm dev` | vite dev server (Worker + SPA + container) |
| `pnpm test` | vitest unit tests (pure logic; no network/Docker) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | production build (Worker + client assets + container image) |
| `pnpm db:generate` | drizzle-kit migration from `src/db/schema.ts` |
| `pnpm db:migrate:local` / `:remote` | apply migrations to D1 |
| `pnpm stripe:setup` | create Stripe meter + metered price (prints ids) |
| `pnpm cf-typegen` | regenerate `worker-configuration.d.ts` |
| `pnpm deploy` | build + `wrangler deploy` |

## Deploying your own instance

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
6. `pnpm deploy` (Workers Paid plan needed for Containers/Workflows/Browser Run).

## Billing model

Single Stripe Billing Meter denominated in credits; the schedule lives in
`src/billing/credits.ts` (`fetch` 1, `browser` 5, `proxy-fetch` 2, `proxy-browser` 5,
+1 screenshot, +1 per started 5 rehosted images). 500 credits/month free without a subscription; the metered subscription uses
graduated tiers (first 500 at $0, then per-credit). Usage is recorded in D1
(`usage_events`, ULID id) and mirrored to Stripe meter events with that id as the
idempotency `identifier`; unreported rows are retried by a 15-minute cron.
