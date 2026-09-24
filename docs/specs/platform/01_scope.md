# Platform Scope

Revision note (2026-09-24, launch): Users can delete their account from the dashboard (billing
settled first; a billing failure deletes nothing). Terms, privacy policy and 特定商取引法に基づく
表記 ship as `/terms`, `/privacy`, `/commerce`; users are responsible for what they fetch, job
contents are not inspected except to operate the service, results are deleted after 7 days.
Revision note (2026-09-24, sign-in fixes): Resending within the validity window re-sends the
same code (encrypted at rest, `resendStrategy: "reuse"`) after an owner report of a rotated
code failing; optional Cloudflare Turnstile on code sending (captcha plugin); OAuth errors
redirect to `/login?error=`. GitHub links to an existing account only after its email is
verified (Better Auth `requireLocalEmailVerified`, kept on purpose — it blocks
pre-registration takeover); one email-code sign-in verifies it.
Revision note (2026-09-24, sign-in): Sign-in is by emailed one-time code (Better Auth email
OTP, Cloudflare Email Sending from `login@webforai.dev`); the account is created on first
sign-in. Passwords are disabled in production (`AUTH_PASSWORD_LOGIN` only for local/e2e).
GitHub stays optional and its button shows only when configured.
Revision note (2026-09-24, regions): `region` is `auto` | `jp` only — the proxy plan has no
dedicated IPs elsewhere (see `03_api.md`).
Revision note (2026-09-23): Added "Surfaces and navigation" — the six user-facing surfaces,
which one documents what, and the linking rules between the docs site and the platform app
(product links and docs links are labelled apart; the app's "Docs" means the platform docs).
Revision note (2026-09-06): Quality review preserves the existing product scope. Conversion now retains literal code, valid formula fallbacks, and caller-owned HAST; dashboard failures remain visible and retryable. Async page accounting and result recovery are specified in `02_architecture.md` and `04_billing.md`.

Revision note (2026-08-24, later): `auto` also escalates on fetch-tier *failures* a browser
plausibly gets past — bot walls (403/406/429), challenges served as 503, Cloudflare edge
52x/530, and network-level refusals — reversing the earlier same-day decision to escalate
on shell detection only. Owner-directed: any Cloudflare-fronted site can refuse a plain
fetch that a browser passes, so failing hard there loses to competitors. Plain origin
errors (404/410/500/502) still fail without escalation, and explicit engines never
substitute.
Revision note (2026-08-24): JS-rendering heuristics ("auto engine") promoted from non-goal
to shipped, by owner decision: a fetch-tier scrape of a client-rendered site returned an
empty body — including for platform.webforai.dev itself — which competitors (Firecrawl)
handle. `auto` is now the default request engine: shell detection
(`webforai.detectClientShell`) escalates fetch-tier results to the browser sibling; see
`03_api.md`. The dashboard/landing SPA's `/` is prerendered at build time so the site is
extractable without JavaScript, gated by a self-extraction check in the build.
Revision note (2026-08-22): Engine `cf-browser` renamed to `browser`; proxy provider named
generically (configuration moved to provider-neutral `PROXY_*` secrets). Official clients
added: the `webforai/platform` TypeScript client (subpath export of the `webforai` npm
package — the npm scope `@webforai` was unavailable) and the `webforai` CLI's platform
loader.
Revision note (2026-08-10): Initial version.

## What

An OSS, self-hostable SaaS platform ("webforai platform", `apps/platform`) that exposes
webforai's crawl→Markdown conversion as a metered HTTP API, deployed entirely on Cloudflare.

## Core capabilities

- **Scrape**: single URL → Markdown (+metadata). Synchronous, runs on a plain Worker — fast,
  not durable.
- **Batch**: list of URLs → Markdown per URL. Asynchronous job.
- **Crawl**: seed URL → recursive same-origin crawl (depth/page limits, include/exclude
  patterns) → Markdown per page. Asynchronous job.
- Async jobs run the **same core logic** on **Cloudflare Workflows** (guaranteed completion,
  retries); results are persisted to KV (payloads >1 MiB spill to R2). Job status/result API.

## HTML acquisition engines (4, plus `auto`)

| engine | runtime | proxy | screenshot |
|---|---|---|---|
| `fetch` | Workers `fetch()` | no | no |
| `browser` | Cloudflare Browser Rendering | no | yes |
| `proxy-fetch` | Node fn in Cloudflare Container (create-nodejs-fn), undici | rotating proxy | no |
| `proxy-browser` | Node fn in Container, Playwright | rotating proxy | yes |

`auto` (the request default) is not a fifth engine but a resolution rule: start with the
cheapest engine that can satisfy the request (`fetch`, or `proxy-fetch` when a region is
set; the browser sibling directly when a screenshot is asked for) and rerun on the browser
sibling when the fetched HTML is a client-rendered shell. Responses always name the
concrete engine that produced them.

## Options

- `screenshot` (engines `browser` / `proxy-browser`): PNG stored in R2, expiring URL returned.
- `rehostImages`: download images referenced by the resulting Markdown, re-upload to R2 with a
  TTL (lifecycle rule), rewrite Markdown URLs to the R2-hosted copies.
- `region` (`auto` | `jp`): egress location, applied by pinning the proxy exit IP to Japan.
  Proxy engines only; the other two egress from Cloudflare and ignore it. No price difference.
- Extraction options passed through to webforai (`extractor` preset, `frontmatter`, ...).

## Accounts, keys, billing

- Login: Better Auth — emailed 6-digit code (10-minute expiry, 3 attempts, encrypted at rest,
  3 sends per minute per IP), optional GitHub. Dashboard SPA for key management,
  usage, billing.
- API keys: Better Auth `apiKey` plugin; API authenticated via `Authorization: Bearer wfa_...`.
- Billing: Stripe usage-based (Billing Meter, credit-denominated). See `04_billing.md`.

## Surfaces and navigation

webforai reaches users through these surfaces; each links to the others under labels that
say where the link goes.

| surface | where | job |
| --- | --- | --- |
| `webforai` library | npm, `packages/webforai` | HTML→Markdown in the user's own code |
| CLI | same package (`npx webforai`) | URL/file→Markdown on stdout; `--engine`/`--region` call the platform |
| `webforai/platform` client | same package (subpath) | typed HTTP client for the platform API |
| Docs site | webforai.dev (`site/`) | the only documentation — library, CLI, client and platform API |
| Platform app | platform.webforai.dev (`apps/platform`) | landing/pricing, sign-up, dashboard (keys, usage, billing, jobs), playground |
| READMEs | GitHub / npm | route readers to the docs site; `apps/platform` README covers running and deploying an instance |

Linking rules:

- The docs site never uses the bare word "Platform" for both the product and its docs: the
  header "Platform" is a dropdown whose entries say which they open ("Open platform",
  "Dashboard & API keys" vs. "Platform docs", "API reference").
- In the platform app, "Docs" opens the platform docs (webforai.dev/platform); library docs
  are linked as "Library docs". The app has no docs pages of its own.
- Wherever a user needs a key or credits — dashboard, CLI error hints, client errors, docs
  quickstart — the dashboard is named with a link.

## Non-goals (initial)

- Multi-region routing of the platform itself (the `region` option above is proxy egress
  geo-targeting, not infrastructure placement), org/team accounts, webhooks on job
  completion (nice-to-have later), PDF conversion.

## Licensing / OSS

The platform ships in this repository under the repo license. Deployment secrets/config stay in
wrangler secrets + env; nothing account-specific is committed.
