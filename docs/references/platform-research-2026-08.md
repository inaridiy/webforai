# Platform research facts (2026-08-10)

Condensed from live-doc research; implementation agents should trust these over training
data. Versions verified against registry.npmjs.org on 2026-08-10.

## Better Auth (1.6.26)

- `drizzleAdapter` import: `better-auth/adapters/drizzle` (subpath of `better-auth` itself);
  `provider: "sqlite"` works with D1: `drizzle(env.DB, { schema })`. Construct the auth
  instance **per request** via a factory taking `env` (D1 binding only exists in-request).
- apiKey plugin is a separate package `@better-auth/api-key` (1.6.26):
  `import { apiKey } from "@better-auth/api-key"`, client `@better-auth/api-key/client`.
  Server verify: `auth.api.verifyApiKey({ body: { key } })` →
  `{ valid, error, key: Omit<ApiKey,"key"> | null }` (key.referenceId = userId). No built-in
  header middleware — read `Authorization: Bearer` yourself. Options: `rateLimitEnabled`,
  per-key `rateLimitTimeWindow/rateLimitMax`, `permissions.defaultPermissions`, `prefix`.
  Adds single `apikey` table.
- `@better-auth/stripe` (1.6.26): fixed plans only, NO metered support. Use it for
  `createCustomerOnSignUp: true` + webhook plumbing (auto route
  `/api/auth/stripe/webhook`, auto-handles checkout.session.completed +
  customer.subscription.created/updated/deleted). peer `stripe ^18..^22`.
  Checkout/portal for the metered price: call stripe SDK directly.
- CLI: `npx auth@latest generate --config <auth.ts> --output <schema.ts> --y` emits drizzle
  sqlite schema (`@better-auth/cli` npm package is stale — use `auth`). `migrate` is
  kysely-only; use drizzle-kit generate + wrangler d1 migrations apply.
- Hono mount: `app.on(["POST","GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))`;
  session read: `auth.api.getSession({ headers: c.req.raw.headers })`.
- KV as secondaryStorage: KV put TTL floor is 60s — set `rateLimit.window >= 60` if used.
- Email/password: `emailAndPassword: { enabled: true }`; GitHub:
  `socialProviders.github { clientId, clientSecret }`, callback
  `<base>/api/auth/callback/github`.

## Stripe (npm `stripe` ^22.4.0)

- Workers: `new Stripe(key, { httpClient: Stripe.createFetchHttpClient() })`.
- Meter: POST /v1/billing/meters `{ display_name, event_name, default_aggregation[formula]=sum,
  customer_mapping[event_payload_key]=stripe_customer_id, customer_mapping[type]=by_id,
  value_settings[event_payload_key]=value }`.
- Metered price with free tier: `billing_scheme=tiered, tiers_mode=graduated,
  tiers[0][unit_amount]=0, tiers[0][up_to]=500, tiers[1][unit_amount_decimal]=0.2,
  tiers[1][up_to]=inf, recurring[interval]=month, recurring[usage_type]=metered,
  recurring[meter]=<meter_id>, currency=usd` on a product.
- Usage: POST /v1/billing/meter_events `{ event_name, identifier(<=100ch, idempotent 24h),
  payload[stripe_customer_id], payload[value] }`. 429 → backoff. 1 concurrent call per
  meter+customer.
- Checkout: mode=subscription, metered line item WITHOUT quantity. Billing Portal:
  usage-based subs can cancel but not switch plans (fine for us).
- stripe.subscriptions list by customer to check active state; rely on webhooks to mirror
  state into D1.

## Cloudflare (Workers/wrangler current)

- Browser Run (ex Browser Rendering): `@cloudflare/playwright@^1.3.5` (tracks pw 1.58);
  binding `"browser": { "binding": "BROWSER" }`; `import { launch } from
  "@cloudflare/playwright"`; `const browser = await launch(env.BROWSER); page.goto(url,
  { waitUntil: "networkidle" }); await page.content(); await page.screenshot({ type: "png",
  fullPage: true })`. Local dev needs remote mode. Paid: 10 browser-hrs/mo incl, $0.09/hr,
  3→120 concurrent.
- Workers fetch(): NO third-party proxy support (hence containers for the egress proxy).
- Workflows: `import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from
  "cloudflare:workers"`; `NonRetryableError` from `cloudflare:workflows`. Step return ≤ 1 MiB
  → persist page results to KV inside the step, return small summaries. `step.do(name,
  {retries:{limit,delay,backoff}, timeout}, fn)`. Trigger: `env.CRAWL_WORKFLOW.create({ id,
  params })`; `instance.status()`. Steps ≤ 10k (paid default). Payload ≤ 1 MiB.
- KV: put TTL min 60s (`expirationTtl`), value ≤ 25 MiB, 1 write/s per key, ≤1000 ops per
  invocation.
- R2 presigned GET via aws4fetch (S3 endpoint `<account>.r2.cloudflarestorage.com`), expiry
  ≤ 7 days. Or public custom domain. Lifecycle rules auto-delete by prefix after N days
  (`wrangler r2 bucket lifecycle`). R2 binding: `env.ARTIFACTS.put(key, bytes, {
  httpMetadata: { contentType } })`.
- Containers (create-nodejs-fn): functions in `*.container.ts` wrapped with `nodejsFn()`
  from `src/__generated__/create-nodejs-fn.runtime`; args/returns must be serializable
  (return base64 strings for binaries). Docker image built by the vite plugin; base image
  configured in vite.config.ts (`mcr.microsoft.com/playwright:v1.62.1-noble`, matches
  `playwright@1.62.1`). Env vars listed in `workerEnvVars` reach the container.

## Rotating proxy gateway (provider-neutral)

- Gateway endpoint comes from `PROXY_URL` (e.g. `http://<gateway-host>:<port>`), auth
  `username:password`; providers commonly append `-rotate` to the username for per-request
  IP rotation and `-{CC}-rotate` for country pinning.
- undici: `new ProxyAgent("http://user-rotate:pass@<gateway-host>:<port>")` → pass as
  `dispatcher` to undici `fetch`/`request`.
- Playwright: `chromium.launch({ proxy: { server: "<PROXY_URL>", username:
  "user-rotate", password: "pass" } })`.
