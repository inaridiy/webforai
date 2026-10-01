# Billing

Revision note (2026-10-01, billing): Launch hardening, owner decisions of 2026-10-01.
Proxy-tier requests (`proxy-fetch`, `proxy-browser`, or `auto` pinned to them by a non-`auto`
region) need an active subscription (`402 payment_required` naming the dashboard); the free
allowance covers `fetch`/`browser`/`auto` only, and the keyless demo refuses non-`auto` regions.
The "optional user-set monthly hard cap" is now a spend cap: default $50, user-set $1–$5,000 in
whole dollars (no unlimited), stored in `billing_state.spend_cap_usd` (`null` = default),
enforced by the same pre-check (`402 spend_cap_reached` once one more credit would put this UTC
month's `PRICE_TIERS` estimate over the cap; jobs re-check before every page). Checkout refuses
a second live subscription (`409 already_subscribed`) and sets
`billing_cycle_anchor_config: { day_of_month: 1, hour: 0 }` with `proration_behavior: none`, so
Stripe periods run 1st→1st and its graduated tiers reset with our UTC calendar month (the first
period is a short stub; the anchor is evaluated by Stripe in UTC). Meter events carry
`timestamp` = the row's `createdAt`. The reconciliation cron (not `waitUntil`) drains up to 10
pages of 100 rows per run, only for users with a Stripe customer; rows that can never be billed
are marked in `usage_events.report_skipped_reason` (`no_customer`, or `expired` past Stripe's
35-day window — logged) instead of blocking the queue. A row Stripe refuses for good
(`StripeInvalidRequestError`, i.e. a 400/404 that is not a rate limit — e.g. an unknown or
deleted customer after switching test→live keys) is marked `rejected` and logged as
`usage_report_rejected` (row id, user, customer, credits, `createdAt`, Stripe code/param/request
id), so it cannot hold newer billable rows behind it; to bill it after fixing the customer,
clear `report_skipped_reason` within the 35-day window and the next run re-sends it.
Rejections naming the meter configuration (`param` `event_name`, codes `archived_meter`/
`no_meter`), authentication/permission errors, 429, 409, 5xx, network and D1 failures stay
retryable and stop the run. A rejection saying the event already exists is treated as reported:
Stripe documents identifier uniqueness but not the error it returns, so this is an assumption
matched conservatively (code `resource_already_exists`, or a message saying the identifier
already exists / is a duplicate); anything less specific is `rejected`, never silently
reported. `report_skipped_reason` is plain `text` in SQL, so `rejected` needed no migration. The webhook route is
`/api/auth/stripe/webhook` (Better Auth plugin), and each subscription event re-fetches the
subscription from Stripe rather than trusting payload order. No automatic tax: the operator is a
免税事業者 and not an invoice issuer.
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
3. Active subscription → proceed until the month's estimate reaches the spend cap (see the
   2026-10-01 note); proxy-tier requests require this state.
4. Execute operation. On success only: insert `usage_events` row (ULID for sync requests; deterministic page id for jobs) and send a Stripe
   meter event with `identifier = usage_events.id` (idempotent retry-safe) and `timestamp` =
   the row's `createdAt`. The first send runs in `ctx.waitUntil`/the page's workflow step;
   failures are retried by the 15-minute cron (`retryUnreportedUsage`); the D1 row is the
   reconciliation source.

## Webhooks

Handled by the Better Auth Stripe plugin at `/api/auth/stripe/webhook` (it verifies
`STRIPE_WEBHOOK_SECRET`); `onEvent` mirrors `customer.subscription.created|updated|deleted` and
`invoice.payment_failed` into `billing_state` by re-fetching the subscription (API reads local
state only — no Stripe call on the hot path).
