# Platform Scope

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

## HTML acquisition engines (4)

| engine | runtime | proxy | screenshot |
|---|---|---|---|
| `fetch` | Workers `fetch()` | no | no |
| `browser` | Cloudflare Browser Rendering | no | yes |
| `proxy-fetch` | Node fn in Cloudflare Container (create-nodejs-fn), undici | rotating proxy | no |
| `proxy-browser` | Node fn in Container, Playwright | rotating proxy | yes |

## Options

- `screenshot` (engines `browser` / `proxy-browser`): PNG stored in R2, expiring URL returned.
- `rehostImages`: download images referenced by the resulting Markdown, re-upload to R2 with a
  TTL (lifecycle rule), rewrite Markdown URLs to the R2-hosted copies.
- `region` (`auto` | `us` | `eu` | `uk` | `jp` | `asia`): coarse egress location, applied by
  pinning the proxy exit IP to a representative country. Proxy engines only; the other two
  egress from Cloudflare and ignore it. No price difference.
- Extraction options passed through to webforai (`extractor` preset, `frontmatter`, ...).

## Accounts, keys, billing

- Login: Better Auth (email/password, optional GitHub). Dashboard SPA for key management,
  usage, billing.
- API keys: Better Auth `apiKey` plugin; API authenticated via `Authorization: Bearer wfa_...`.
- Billing: Stripe usage-based (Billing Meter, credit-denominated). See `04_billing.md`.

## Non-goals (initial)

- Multi-region routing of the platform itself (the `region` option above is proxy egress
  geo-targeting, not infrastructure placement), org/team accounts, JS-rendering heuristics
  ("auto engine"), webhooks on job completion (nice-to-have later), PDF conversion.

## Licensing / OSS

The platform ships in this repository under the repo license. Deployment secrets/config stay in
wrangler secrets + env; nothing account-specific is committed.
