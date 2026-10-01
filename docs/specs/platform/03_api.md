# Platform API

Revision note (2026-10-01, permalinks and sitemaps): `GET /<http(s) URL>` returns Markdown as
`text/markdown`, re-dispatched internally to `POST /v1/scrape` (with a Bearer key) or
`POST /v1/demo/scrape` (without), so auth, limits and billing are those routes' own. Crawl
gains `sitemap: "skip" | "include" | "only"` (default `skip`): sitemap URLs from robots.txt
`Sitemap:` lines (else `/sitemap.xml`, indexes and `.gz` expanded, ≤ 8 documents) are
scope-filtered and queued at depth 1; `only` follows no page links.
Revision note (2026-10-01, security): Every engine follows HTTP redirects itself, hop by hop
(≤ 10), and each hop target passes the SSRF guard *before* it is requested (robots.txt and
image rehosting too); browser engines abort subresource/frame requests to private addresses and
refuse a page whose redirect hop reached one (`400 invalid_url`). The guard also refuses
NAT64/6to4/IPv4-compatible IPv6 forms of private IPv4, 198.18.0.0/15, TEST-NETs, multicast and
reserved space; it is lexical (no DNS resolution on Workers). Input caps: URLs ≤ 2,048 chars;
`/v1` and `/api` bodies ≤ 256 KiB (`413 payload_too_large`); `includePaths`/`excludePaths` ≤ 20
patterns of ≤ 200 chars each, still regex but screened for catastrophic backtracking (repeated
groups around a quantifier or alternation, backreferences, > 3 unbounded quantifiers →
`400 invalid_request`). Rendered HTML ≤ 5 MiB; screenshots clip at 16,384 px tall and fall back
to the viewport above 10 MiB. Image rehosting stores raster formats only (png, jpeg, gif,
webp, avif, bmp, ico, tiff; SVG stays at its origin, failure reason "raster formats only") and
runs 4 downloads at a time. `/artifacts/*` responses carry `Content-Security-Policy:
default-src 'none'; sandbox`, `nosniff` and `Cross-Origin-Resource-Policy: cross-origin`;
anything but raster images and JSON downloads as an attachment. State-changing
`/api/dashboard/*` requests need `Origin` equal to `BASE_URL`'s origin (`403 forbidden_origin`).
Revision note (2026-10-01, limits): `/v1` is limited per account, not per key — free 60,
paid (active subscription) 600 requests/minute on Workers Rate Limiting bindings, over it
`429 rate_limited` with `Retry-After: 60`; Better Auth's per-key D1 limiter (120/min) is off.
Batch/crawl creation (async scrape included) answers `429 too_many_jobs` while the account
has 3 (free) / 20 (paid) jobs queued or running. API keys: 50 per account. The demo adds a
per-client burst cap (3/minute, binding) and keys IPv6 clients by /64; its KV counters are
documented as approximate. Missing/invalid key errors name `<BASE_URL>/dashboard`. See
"Rate limits" below.
Revision note (2026-09-24, robots default): `respectRobotsTxt` now defaults to `true` for
`/v1/crawl` (still `false` for scrape and batch); callers may pass `false`. Owner decision after
comparing Firecrawl (crawl honors robots.txt by default, overridable only on Enterprise;
single scrape does not check) — same visible default, no plan gating. Crawl jobs stored
before this change carry no value and keep running with `false`.
Revision note (2026-09-24, robots): Added the opt-in `respectRobotsTxt` boolean (default
`false`, unchanged behaviour) to scrape, batch and crawl — not the demo. When true, each URL is
checked against `<origin>/robots.txt` before any engine runs (all engines, `auto` escalation
included, plus meta-refresh hop targets); a disallowed URL fails with `403 robots_disallowed`,
recorded as a failed page in jobs and never billed. See "robots.txt option" below.
Revision note (2026-09-24, regions): `region` narrowed to `auto` | `jp` (owner decision). The
proxy plan has Japanese and unspecified-country IPs only, so `us`/`eu`/`uk`/`asia` could not
be honoured; they are now rejected with `400 invalid_request`.
Revision note (2026-09-24, cache): Successful demo responses are cached for 10 minutes per
data center (Workers Cache API) by normalized URL + region; a hit answers before the rate
limiter, carries `X-Demo-Cache: hit`, and neither scrapes nor counts against the limits.
Revision note (2026-09-24, later): Demo truncation limit raised from 8000 to 40,000
characters (owner request: 8000 showed ~15% of a Wikipedia article, too little to judge
quality). Conversion already ran on the whole page, so only response size grows; the per-IP
and daily caps remain the cost bound.
Revision note (2026-09-24): The demo response names the concrete `engine` that `auto`
resolved to, so the docs-site and landing demos can show when a page needed a browser.
Revision note (2026-09-06): Public target validation precedes job creation and demo counters; invalid crawl regexes return `400 invalid_request`. Internal/configuration failures expose stable generic messages while logs retain diagnostics. Dashboard jobs and usage validate response shapes, distinguish errors from empty state, and support retry. SDK polling deadlines cover active requests and bodies; cancellation propagates to transports.

Revision note (2026-08-24, later): Fetch-tier acquisition (`fetch`, `proxy-fetch`, and
`auto` before any escalation) now follows meta-refresh redirects: an HTTP 200 page whose
`<meta http-equiv="refresh">` names an http(s) target (delay ≤ 10s, not the page itself)
is re-fetched on the same engine, up to 3 hops, each hop target passing the SSRF guard.
Billed as one operation, like HTTP redirects; the response `url` is the final page.
Browser engines follow refreshes natively. The demo's teaser truncation now cuts at the
last blank line within 500 chars of the 8000-char limit and appends an in-markdown notice
naming the omitted character count (`truncated` flag unchanged).
Revision note (2026-08-24): Added `engine: "auto"` and made it the request default
(pre-launch change). `auto` runs the cheapest engine that can satisfy the request and, when
the fetched HTML is a client-rendered shell (`webforai.detectClientShell`: SPA shell,
noscript-only, empty body, anti-bot interstitial), reruns on the browser sibling —
`fetch`→`browser`, or `proxy-fetch`→`proxy-browser` when a region is set; `screenshot`
starts directly at the browser tier. The response `engine` and `credits` always reflect the
engine that actually produced the result. Explicit engines never substitute; a fetch-tier
result that looks like a shell (or an `auto` escalation that failed) carries a top-level
`warning` string. The demo endpoint now runs `auto` and requires a configured proxy only
for geo-targeted (`region` ≠ `auto`) requests.
Revision note (2026-08-22): Engine `cf-browser` renamed to `browser` (clean break, pre-launch;
enum is now `fetch | browser | proxy-fetch | proxy-browser`). Proxy provider references made
generic. Documented the actual results envelope (`{ jobId, status, results, cursor? }`) and
that success responses carry no `region` field. Official clients: `webforai/platform`
(subpath export of the `webforai` package) and the `webforai` CLI (`--engine`/`--region`
against this API).
Revision note (2026-08-12): Added the `region` option to scrape/batch/crawl (egress
geo-targeting, honoured by the proxy engines only) and the public `POST /v1/demo/scrape`
endpoint (no API key, rate limited, not billed).
Revision note (2026-08-10): Initial version.

Auth: `Authorization: Bearer <api key>` (Better Auth apiKey plugin). All bodies JSON.
Errors: `{ error: { code, message } }` with proper status; failed operations are never billed.

## POST /v1/scrape — synchronous, single URL

Runs on the plain Worker (fast, not durable). With `"async": true` it instead enqueues a
1-URL job (same shape as batch) and returns `202 { jobId }`.

```jsonc
{
  "url": "https://example.com/article",
  "engine": "auto",             // auto (default) | fetch | browser | proxy-fetch | proxy-browser
  "screenshot": false,           // auto / browser / proxy-browser only (400 otherwise)
  "rehostImages": false,
  "region": "auto",             // auto | jp — proxy engines only
  "respectRobotsTxt": false,     // opt-in robots.txt check (see below)
  "async": false,
  "convert": {                   // passthrough to webforai (all optional)
    "extractor": "auto",        // auto | takumi | minimal | none
    "frontmatter": true,
    "baseUrl": "..."
  }
}
```

`region` picks the egress location for `proxy-fetch` / `proxy-browser` by pinning the proxy
exit IP to a country — `jp`→JP, the only region the proxy plan has dedicated IPs for
(`src/core/regions.ts` is the source of truth). `auto` (the default) does no
geo-targeting. `fetch` and `browser` egress from Cloudflare and ignore the field rather than
failing, so one default can be set for a mixed-engine workload. Pricing is unaffected.

200:

```jsonc
{
  "url": "https://example.com/article",
  "engine": "fetch",            // the engine that ran — `auto` resolves to a concrete one
  "markdown": "# ...",
  "metadata": { "title": "..." },
  "screenshotUrl": "https://...r2...", // when requested; expires
  "images": [{ "original": "https://...", "rehosted": "https://..." }],
  "credits": 1,
  "warning": "..."              // only when the result is probably degraded (unrendered shell)
}
```

`engine: "auto"` semantics: start with `fetch` (`proxy-fetch` when `region` ≠ `auto`;
`browser`/`proxy-browser` directly when `screenshot` is true). Two escalation triggers,
both rerunning on the browser sibling:

- **Shell**: the fetched HTML is a client-rendered shell. If this escalation itself fails,
  the unrendered result is returned with a `warning` instead of failing.
- **Blocked fetch** (revision 2026-08-24): the fetch tier *threw*, and the failure is one a
  real browser regularly gets past — upstream 403/406/429/503/520–526/530, or a
  network-level failure with no upstream status (timeout, refused connection). Plain
  origin errors (404, 410, 500, 502), SSRF-refused targets, oversized and non-HTML
  responses are rethrown without escalation — a browser would see the same thing. If the
  escalation also fails, the error names both failures.

### robots.txt option

`respectRobotsTxt: true` honors the target site's robots.txt rules. Default: `false` for scrape
and batch, `true` for crawl. When on:

- Before any engine runs, the Worker fetches `<origin>/robots.txt` (Workers `fetch` with
  `cf: { cacheTtl: 3600, cacheEverything: true }`, so repeat checks hit Cloudflare's edge
  cache; 5 s timeout; first 512 KiB parsed). Meta-refresh hop targets are checked the same way;
  HTTP redirects followed inside an engine are not re-checked against robots.txt (they are
  against the SSRF guard).
- Rules come from the group naming the product token `webforai-platform` (case-insensitive),
  else the `*` group, else nothing is disallowed. Matching is RFC 9309: the longest matching
  `allow`/`disallow` pattern wins (`allow` on a tie), `*` wildcards, trailing `$` anchor,
  matched against path + query. `/robots.txt` itself is always allowed.
- Any 4xx, 5xx, network error, timeout or non-`text/*` response counts as "no rules" (the
  page is fetched). `Crawl-delay` and `Sitemap` lines are ignored.
- A disallowed URL fails with `403 robots_disallowed`. Sync scrape returns the error; in
  batch/crawl jobs the page is recorded as failed. Nothing is billed either way. A crawl still
  enqueues discovered links; each one is checked when its turn comes.

Implementation: `src/core/robots.ts` (parser/matcher), `src/core/robots-fetch.ts` (loader),
checked in `fetchForScrape` (`src/core/scrape-core.ts`).

Billing follows the returned `engine` — a scrape that only succeeded via the browser bills
5, and a scrape that failed on both tiers bills nothing. Explicitly chosen engines never
substitute — a fetch-tier engine that hits a shell returns its result with a `warning`,
and one that hits a blocked fetch fails.

## POST /v1/batch — asynchronous, URL list

```jsonc
{ "urls": ["https://a", "https://b"], "engine": "auto", "screenshot": false,
  "rehostImages": false, "region": "auto", "respectRobotsTxt": false, "convert": { } }
```

Limits: ≤100 URLs per job (initial). Returns `202 { "jobId": "job_..." }`.

## POST /v1/crawl — asynchronous, recursive

```jsonc
{
  "url": "https://docs.example.com/",
  "engine": "auto",
  "maxDepth": 2,                 // ≤ 5
  "limit": 50,                   // pages, ≤ 500
  "includePaths": ["^/docs"],   // regex on pathname, optional; ≤ 20 patterns, ≤ 200 chars each
  "excludePaths": [],            // same rules; backtracking-prone patterns are refused (below)
  "sameOrigin": true,            // fixed true initially
  "sitemap": "skip",             // "skip" | "include" | "only"
  "screenshot": false, "rehostImages": false, "region": "auto", "respectRobotsTxt": true,
  "convert": { }
}
```

Link discovery: `<a href>` from the fetched HTML (before extraction), normalized, deduped,
fragment-stripped, same-origin filtered, BFS by depth until `limit`. Returns `202 { jobId }`.
Discovered links longer than 2,048 characters are skipped.

`sitemap`: with `include` or `only`, one Workflow step (`sitemap`, replay-stable) reads the
site's sitemaps — the robots.txt `Sitemap:` lines, else `<origin>/sitemap.xml`; sitemap indexes
and gzipped files are expanded, at most 8 documents, every redirect hop SSRF-checked —
keeps the URLs that pass the same origin and include/exclude rules (up to `limit`), and queues
them at depth 1 right after the seed's own links (so `maxDepth: 0` ignores them). `only` follows
no links found on pages. A sitemap that cannot be read contributes nothing; the crawl goes on.

Path patterns run on a backtracking regex engine, so `src/core/links.ts`
(`pathPatternProblem`) refuses, with `400 invalid_request`, a pattern that repeats a group
containing a quantifier or an alternation (`(a+)+`, `(a|ab)*`; an optional `(…)?` is fine),
uses backreferences, repeats more than 1,000 times, or has more than three unbounded
quantifiers (`*`, `+`, `{n,}`). Prefix/suffix patterns such as `^/docs/`, `\.html$` and
`^/(en|ja)/blog/.+` pass.

If Workflow creation throws, the server checks the persisted instance id before deciding
whether it was accepted. If both scheduling and lookup are inconclusive, it returns
`503 scheduling_unknown` with the job id in the message, preserves the queued row, and
records the ambiguity. Query that job and reconcile its Workflow instance before submitting
a replacement; the server cannot promise that the first attempt had no side effects.

## GET /v1/jobs/:id

```jsonc
{ "jobId": "...", "type": "crawl", "status": "running",
  "total": 50, "completed": 12, "failed": 1, "credits": 13,
  "expiresAt": "..." }
```

## GET /v1/jobs/:id/results?cursor=...

`{ "jobId": "...", "status": "running", "results": [...], "cursor": "..." }` — `cursor` is
absent on the last page, page size 20. Each item mirrors the sync scrape response plus
`{ "status": "ok" | "error", "error": {...} }`. Large markdown (>100 KiB) is replaced by
`{ "status": "ok", "url", "engine", "credits", "resultUrl": "<expiring R2 url>" }`.

Marked jobs read results from canonical D1/R2 records even if KV publication failed.
Cursors are opaque and must be returned unchanged. A missing unexpired archive returns
`503 result_unavailable`; expired pages are omitted after the original seven-day retention.

## POST /v1/demo/scrape — public demo (no API key)

Powers the "try it" box on the docs site, which is a different origin, so the route sends CORS
headers (`GET/POST/OPTIONS`, any origin). It is mounted **before** the `/v1/*` API-key
middleware in `src/index.ts`; Hono stops at the first matched handler that returns a response,
so no key is required. Nothing is billed and no usage is recorded.

```jsonc
{ "url": "https://example.com/article", "region": "auto" }   // strict: no other keys
```

Everything else is fixed: engine `auto` (so the demo renders client-side pages instead of
showing an empty body), no screenshot, no image rehosting, default conversion.

200:

```jsonc
{ "url": "https://example.com/article", "region": "auto",
  "engine": "fetch",            // what auto resolved to: fetch | browser | proxy-fetch | proxy-browser
  "markdown": "# ...",          // cut near 40,000 chars at a blank line, with an in-markdown notice
  "truncated": false,
  "title": "...",               // when the page has one
  "metadata": { "title": "..." } }
```

Successful responses are cached for 10 minutes per data center, keyed by the normalized URL
(fragment dropped) and region. A cache hit is answered first — `X-Demo-Cache: hit`, no scrape,
no rate-limit count — so the docs site's example buttons do not re-run the engines.

Rate limits (checked *before* the proxy runs, so a rejection costs nothing; fail-closed — a
KV or binding failure denies rather than allows). The client is `CF-Connecting-IP`, bucketed
as the IPv4 address or the IPv6 /64 (`src/ops/ip.ts`):

| scope | where | limit |
|---|---|---|
| per client, burst | `DEMO_RATE_LIMIT` binding | 3 requests / 60 s (per Cloudflare location) |
| per client | KV `demo:ip:<ipv4 \| ipv6-prefix::/64>` | 5 requests / 10 minutes from the first one |
| global, per UTC day | KV `demo:global:<YYYY-MM-DD>` | 500 requests, resets at UTC midnight |

The KV windows are read-modify-write, not atomic: concurrent requests can overshoot them
slightly (approximate by design; the binding bounds bursts). A deployment without the
binding applies only the KV windows.

429 carries a `Retry-After` header and an extended error body:

```jsonc
{ "error": { "code": "rate_limited", "message": "...", "retryAfter": 600 } }
```

A deployment without proxy settings answers `503 engine_unavailable` only for geo-targeted
requests (`region` ≠ `auto`); auto-region requests run on the plain engines and need no
proxy. Constants live in `src/routes/demo.ts`.

## GET /<http(s) URL> — Markdown permalink

`GET /https://example.com/page?x=1` → `200 text/markdown; charset=utf-8`, body = the Markdown.
Everything after the first `/` (query included) is the target; `/https:/host` (a collapsed
`//`) is accepted. The route re-dispatches through the Worker's router:

- `Authorization: Bearer wfa_…` → `POST /v1/scrape { url }` (engine `auto`): billed, API-key
  limits; `Cache-Control: private, no-store`; `X-Webforai-Credits`.
- no key → `POST /v1/demo/scrape { url }`: the demo's limits, cache and 40k truncation;
  `Cache-Control: public, max-age=600`; `X-Webforai-Truncated`.

Both set `X-Webforai-Engine`, `X-Webforai-Source`, `Vary: Authorization`, CORS `*`. An error
envelope becomes one `code: message` text line with the original status and `Retry-After`.

## Dashboard API (session cookie, not API key)

`/api/dashboard/usage` (period usage from D1 ledger), key CRUD via Better Auth client,
`/api/dashboard/billing/checkout` + `/billing/portal` (Stripe redirects), and
`/api/dashboard/jobs` (the latest 50 jobs; no 30-day filter). Jobs fetch errors are surfaced
with Retry. Authentication service errors keep the dashboard open rather than treating
an outage as a signed-out session.

CSRF: `/api/dashboard/*` is cookie-authenticated, so any non-GET/HEAD/OPTIONS request must
carry an `Origin` header equal to `BASE_URL`'s origin, else `403 forbidden_origin` (a missing
`Origin` included). `/api/auth/*` is exempt — Better Auth enforces its own trusted origins,
and the Stripe webhook there is server-to-server.

## Behavioural rules

- Billing guard runs **before** side effects; usage recorded **after** success only
  (per-page in async jobs — a failed page is not billed).
- SSRF guard (`src/core/ssrf.ts`): public http(s) URLs only — private, loopback, link-local,
  CGNAT, benchmarking, documentation, multicast and reserved IPv4 ranges (including their
  IPv4-mapped, IPv4-compatible, NAT64 and 6to4 IPv6 forms), ULA/link-local/multicast IPv6,
  localhost/`.local`/`.internal`, credentials in the URL and non-standard ports are rejected at
  validation time. The check is lexical: Workers has no resolver, so a public name that
  resolves privately is left to the egress network (Cloudflare's edge or the proxy gateway).
  Every fetcher walks HTTP redirects itself (`src/core/redirects.ts`, ≤ 10 hops) and checks
  each hop before requesting it; browser engines abort private subresource/frame requests and
  refuse the page (`400 invalid_url`) if a redirect hop — which Playwright cannot intercept —
  reached a private address. Meta-refresh hop targets pass the same guard.
- Request caps: bodies on `/v1/*` and `/api/*` ≤ 256 KiB (`413 payload_too_large`; a chunked
  body is cut at the cap and fails as invalid JSON), URLs ≤ 2,048 characters. Rendered HTML
  from the browser engines ≤ 5 MiB like fetched HTML (`413 response_too_large`).
- Artifacts (`GET /artifacts/*`): served with `Content-Security-Policy: default-src 'none';
  sandbox`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: cross-origin`
  (rehosted images are embedded by other sites) and `Referrer-Policy: no-referrer`; only
  raster images and JSON render inline, anything else is `Content-Disposition: attachment`.
- Meta-refresh redirects: fetch-tier engines follow `<meta http-equiv="refresh">` stubs
  (≤ 3 hops, delay ≤ 10s, http(s) targets only) before shell detection, so an HTTP 200
  redirect page converts as its destination rather than as "Redirecting…".
- Self-scrapes: the `fetch` engine serves URLs on the deployment's own host (from
  `BASE_URL`) out of the Workers assets binding — a Worker cannot `fetch()` its own zone
  (Cloudflare answers the looping subrequest with a 522). Same bytes as the public URL,
  same pricing. (Revision note 2026-08-24: added after the deployed demo answered
  `fetch_failed: upstream responded 522` for platform.webforai.dev itself.)
- Rate limits (Revision note 2026-10-01, limits: replaces "per-key requests/min via Better
  Auth apiKey rate limiting"): see "Rate limits" below.

## Rate limits

Per account, by tier — "paid" is an active subscription (`isSpendable`, the spend guard's
predicate), everyone else (including every user of a deployment without Stripe) is "free".
Constants: `src/ops/limits.ts`.

| limit | free | paid | refusal |
|---|---|---|---|
| `/v1/*` requests per minute (all of the account's keys together) | 60 | 600 | `429 rate_limited`, `Retry-After: 60` |
| batch + crawl jobs (async scrape included) in `queued`/`running` | 3 | 20 | `429 too_many_jobs` |
| API keys | 50 | 50 | `403` from `POST /api/auth/api-key/create` |

- Request limits run in `requireApiKey` after key verification, on the Workers Rate Limiting
  binding of the owner's tier (`RATE_LIMIT_FREE`, `RATE_LIMIT_PAID`), keyed by user id —
  keys are free to create, so a per-key limit would bound nothing. Counters are per Cloudflare
  location and eventually consistent: a cost/fairness bound, not exact accounting. Without
  the binding the API runs unlimited (one warning per isolate); a binding error fails open
  (the spend guard still bounds cost).
- The job limit is a count check before the job row is created, not a reservation: racing
  creations can exceed it by the race width.
- The key limit is a Better Auth `hooks.before` check on key creation (same race caveat).
- Error bodies keep the `{ error: { code, message } }` envelope; `rate_limited` and
  `too_many_jobs` messages state the limit and tier. `401 invalid_api_key` messages end with
  `Create a key at <BASE_URL>/dashboard`.
