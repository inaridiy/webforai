# Billing

Revision note (2026-08-10): Initial version.

## Model: credit-denominated usage billing

Single Stripe Billing **Meter** (`webforai_credits`); every operation reports N credits.
One metered subscription price, graduated tiers: first allowance free, then per-credit price.
A single meter keeps Stripe simple while letting per-operation prices differ.

### Credit schedule (single source: `src/billing/credits.ts`)

| operation | credits |
|---|---|
| scrape via `fetch` | 1 |
| scrape via `proxy-fetch` | 2 |
| scrape via `proxy-browser` | 5 |
| scrape via `cf-browser` | 5 |
| screenshot option | +1 |
| image rehost | +1 per started 5 images |

Batch/crawl bill per successfully converted page using the same schedule.

### Stripe objects (created by `scripts/stripe-setup.ts`, ids stored as secrets/env)

- Meter: event_name `webforai_credits`, aggregation sum over `payload.value`,
  customer mapped by `payload.stripe_customer_id`.
- Product "webforai platform" + Price: recurring monthly, usage-based on the meter,
  graduated tiers — first 500 credits/month at $0, then $0.002/credit (tune later).
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
4. Execute operation. On success only: insert `usage_events` row (ULID id) and send a Stripe
   meter event with `identifier = usage_events.id` (idempotent retry-safe). Meter event
   failures are retried via `ctx.waitUntil`/workflow step; the D1 row is the reconciliation
   source.

## Webhooks

Handled by the Better Auth Stripe plugin where possible; otherwise a `/api/stripe/webhook`
route verifying `STRIPE_WEBHOOK_SECRET`: `checkout.session.completed`,
`customer.subscription.updated|deleted`, `invoice.payment_failed` (mark subscription state in
D1; API reads local state only — no Stripe call on the hot path).
