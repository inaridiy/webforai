# Billing

Revision note (2026-09-24, correction): `proxy-browser` is 3 credits, not 10. The earlier
note assumed a per-GB residential proxy (~$4/GB); the deployed egress proxy is a flat
datacenter plan ($3.75/month, 100 IPs, 250 GB/month cap — about $0.015/GB), so proxy-browser
costs about what `browser` does (~$0.2 per 1k pages). Routing through the proxy now adds one
credit to either tier. The binding constraint is the monthly bandwidth cap: past it the
provider stops the proxies, and every proxy engine (and region-pinned `auto`/demo) fails with
`engine_failed`/`fetch_failed` until the cap resets — ~100k–250k proxy-browser pages or
~2M proxy-fetch pages a month.
Revision note (2026-09-24): Price schedule revised by owner decision after a competitor and
unit-cost review (evidence in `.agents/execplans/2026-09-24-api-cost.md`): `browser` 5→2
credits, `proxy-browser` 5→10 (its proxy bandwidth cost ~$5–10 per 1k pages exceeded the old
price), free allowance 500→1,000 credits/month, per-credit price $0.002 → graduated
$0.001 / $0.0007 above 100k / $0.0005 above 1M credits a month. Tiers now live in
`PRICE_TIERS` (`src/billing/credits.ts`) and the setup script creates a new Stripe price under
lookup key `webforai_platform_credits_v2`; v1 subscriptions stay on the old price until moved.
Revision note (2026-09-06): Successful async usage uses a deterministic job/page identifier. A D1 batch atomically writes usage, counters, and an immutable completion marker; replay and concurrent attempts reuse that record. Sync usage retains ULIDs. This guarantees local accounting uniqueness; Stripe meter reconciliation still relies on the provider’s finite deduplication window, so it is not an unlimited exactly-once external billing guarantee.

Revision note (2026-08-24): `engine: "auto"` (the new request default) has no price of its
own — the operation bills the engine that actually produced the returned result (1, 2 or
5), and only that engine: an escalated run does not also bill the discarded fetch. The
`usage_events` operation column records the resolved engine.
Revision note (2026-08-22): Engine `cf-browser` renamed to `browser` in the credit schedule
(same 5-credit price).
Revision note (2026-08-10): Initial version.

## Model: credit-denominated usage billing

Single Stripe Billing **Meter** (`webforai_credits`); every operation reports N credits.
One metered subscription price, graduated tiers: first allowance free, then per-credit price.
A single meter keeps Stripe simple while letting per-operation prices differ.

### Credit schedule (single source: `src/billing/credits.ts`)

| operation | credits |
|---|---|
| scrape via `fetch` | 1 |
| scrape via `browser` | 2 |
| scrape via `proxy-fetch` | 2 |
| scrape via `proxy-browser` | 3 |
| screenshot option | +1 |
| image rehost | +1 per started 5 images |

Batch/crawl bill per successfully converted page using the same schedule.

### Stripe objects (created by `scripts/stripe-setup.ts`, ids stored as secrets/env)

- Meter: event_name `webforai_credits`, aggregation sum over `payload.value`,
  customer mapped by `payload.stripe_customer_id`.
- Product "webforai platform" + Price (lookup key `webforai_platform_credits_v2`): recurring
  monthly, usage-based on the meter, graduated tiers from `PRICE_TIERS`:

  | credits in the month | $ per credit |
  |---|---|
  | 1–1,000 | 0 (the free allowance) |
  | 1,001–100,000 | 0.001 |
  | 100,001–1,000,000 | 0.0007 |
  | above 1,000,000 | 0.0005 |

  Stripe prices are immutable: a schedule change is a new versioned lookup key, and existing
  subscriptions are moved to it at a period boundary (README, "Changing prices").
- Customer per user via Better Auth Stripe plugin (created on signup/first checkout).

Revision note (2026-08-10): `@better-auth/stripe` models fixed plans only — no metered
support. It is used solely for customer creation + webhook plumbing; checkout sessions
(metered price, no quantity), the billing portal redirect, and meter events go through the
`stripe` SDK (v22, `Stripe.createFetchHttpClient()` on Workers) directly. Stripe positions
Metronome for new usage billing, but Billing Meters remain fully supported and are the
simplest OSS-reproducible primitive — we use Billing Meters deliberately.

## Enforcement (fail-closed order)

1. Resolve user from API key → stripe customer + subscription state (D1).
2. No active subscription → allow only within the free allowance, tracked against the local
   D1 `usage_events` ledger for the current calendar month; beyond it → `402 payment_required`.
3. Active subscription → proceed; optional user-set monthly hard cap later.
4. Execute operation. On success only: insert `usage_events` row (ULID for sync requests; deterministic page id for jobs) and send a Stripe
   meter event with `identifier = usage_events.id` (idempotent retry-safe). Meter event
   failures are retried via `ctx.waitUntil`/workflow step; the D1 row is the reconciliation
   source.

## Webhooks

Handled by the Better Auth Stripe plugin where possible; otherwise a `/api/stripe/webhook`
route verifying `STRIPE_WEBHOOK_SECRET`: `checkout.session.completed`,
`customer.subscription.updated|deleted`, `invoice.payment_failed` (mark subscription state in
D1; API reads local state only — no Stripe call on the hot path).
