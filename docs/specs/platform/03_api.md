# Platform API

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

Billing follows the returned `engine` — a scrape that only succeeded via the browser bills
5, and a scrape that failed on both tiers bills nothing. Explicitly chosen engines never
substitute — a fetch-tier engine that hits a shell returns its result with a `warning`,
and one that hits a blocked fetch fails.

## POST /v1/batch — asynchronous, URL list

```jsonc
{ "urls": ["https://a", "https://b"], "engine": "auto", "screenshot": false,
  "rehostImages": false, "region": "auto", "convert": { } }
```

Limits: ≤100 URLs per job (initial). Returns `202 { "jobId": "job_..." }`.

## POST /v1/crawl — asynchronous, recursive

```jsonc
{
  "url": "https://docs.example.com/",
  "engine": "auto",
  "maxDepth": 2,                 // ≤ 5
  "limit": 50,                   // pages, ≤ 500
  "includePaths": ["^/docs"],   // regex on pathname, optional
  "excludePaths": [],
  "sameOrigin": true,            // fixed true initially
  "screenshot": false, "rehostImages": false, "region": "auto", "convert": { }
}
```

Link discovery: `<a href>` from the fetched HTML (before extraction), normalized, deduped,
fragment-stripped, same-origin filtered, BFS by depth until `limit`. Returns `202 { jobId }`.

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

Rate limits (KV counters checked *before* the proxy runs, so a rejection costs nothing;
fail-closed — a KV failure denies rather than allows):

| scope | key | limit |
|---|---|---|
| per IP (`CF-Connecting-IP`) | `demo:ip:<ip>` | 5 requests / 10 minutes from the first one |
| global, per UTC day | `demo:global:<YYYY-MM-DD>` | 500 requests, resets at UTC midnight |

429 carries a `Retry-After` header and an extended error body:

```jsonc
{ "error": { "code": "rate_limited", "message": "...", "retryAfter": 600 } }
```

A deployment without proxy settings answers `503 engine_unavailable` only for geo-targeted
requests (`region` ≠ `auto`); auto-region requests run on the plain engines and need no
proxy. Constants live in `src/routes/demo.ts`.

## Dashboard API (session cookie, not API key)

`/api/dashboard/usage` (period usage from D1 ledger), key CRUD via Better Auth client,
`/api/dashboard/billing/checkout` + `/billing/portal` (Stripe redirects), and
`/api/dashboard/jobs` (the latest 50 jobs; no 30-day filter). Jobs fetch errors are surfaced
with Retry. Authentication service errors keep the dashboard open rather than treating
an outage as a signed-out session.

## Behavioural rules

- Billing guard runs **before** side effects; usage recorded **after** success only
  (per-page in async jobs — a failed page is not billed).
- SSRF guard: public http(s) URLs only — private IP ranges, localhost, and non-standard
  ports are rejected at validation time for every engine, and re-checked in the container
  fetcher (redirect targets included). Meta-refresh hop targets pass the same guard.
- Meta-refresh redirects: fetch-tier engines follow `<meta http-equiv="refresh">` stubs
  (≤ 3 hops, delay ≤ 10s, http(s) targets only) before shell detection, so an HTTP 200
  redirect page converts as its destination rather than as "Redirecting…".
- Self-scrapes: the `fetch` engine serves URLs on the deployment's own host (from
  `BASE_URL`) out of the Workers assets binding — a Worker cannot `fetch()` its own zone
  (Cloudflare answers the looping subrequest with a 522). Same bytes as the public URL,
  same pricing. (Revision note 2026-08-24: added after the deployed demo answered
  `fetch_failed: upstream responded 522` for platform.webforai.dev itself.)
- Rate limit: per-key requests/min via Better Auth apiKey rate limiting (initial),
  plus job-level caps above.
