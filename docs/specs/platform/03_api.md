# Platform API

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
  "engine": "fetch",            // fetch | browser | proxy-fetch | proxy-browser
  "screenshot": false,           // browser / proxy-browser only (400 otherwise)
  "rehostImages": false,
  "region": "auto",             // auto | us | eu | uk | jp | asia — proxy engines only
  "async": false,
  "convert": {                   // passthrough to webforai (all optional)
    "extractor": "auto",        // auto | takumi | minimal | none
    "frontmatter": true,
    "baseUrl": "..."
  }
}
```

`region` picks a coarse egress location for `proxy-fetch` / `proxy-browser` by pinning the
proxy exit IP to one **representative** country per region — `us`→US, `eu`→DE, `uk`→GB,
`jp`→JP, `asia`→SG (`src/core/regions.ts` is the source of truth). `auto` (the default) does no
geo-targeting. `fetch` and `browser` egress from Cloudflare and ignore the field rather than
failing, so one default can be set for a mixed-engine workload. Pricing is unaffected.

200:

```jsonc
{
  "url": "https://example.com/article",
  "engine": "fetch",
  "markdown": "# ...",
  "metadata": { "title": "..." },
  "screenshotUrl": "https://...r2...", // when requested; expires
  "images": [{ "original": "https://...", "rehosted": "https://..." }],
  "credits": 1
}
```

## POST /v1/batch — asynchronous, URL list

```jsonc
{ "urls": ["https://a", "https://b"], "engine": "fetch", "screenshot": false,
  "rehostImages": false, "region": "auto", "convert": { } }
```

Limits: ≤100 URLs per job (initial). Returns `202 { "jobId": "job_..." }`.

## POST /v1/crawl — asynchronous, recursive

```jsonc
{
  "url": "https://docs.example.com/",
  "engine": "fetch",
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

## POST /v1/demo/scrape — public demo (no API key)

Powers the "try it" box on the docs site, which is a different origin, so the route sends CORS
headers (`GET/POST/OPTIONS`, any origin). It is mounted **before** the `/v1/*` API-key
middleware in `src/index.ts`; Hono stops at the first matched handler that returns a response,
so no key is required. Nothing is billed and no usage is recorded.

```jsonc
{ "url": "https://example.com/article", "region": "auto" }   // strict: no other keys
```

Everything else is fixed: engine `proxy-fetch`, no screenshot, no image rehosting, default
conversion.

200:

```jsonc
{ "url": "https://example.com/article", "region": "auto",
  "markdown": "# ...",          // truncated to 8000 chars
  "truncated": false,
  "title": "...",               // when the page has one
  "metadata": { "title": "..." } }
```

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

A deployment without proxy settings answers `503 engine_unavailable`. Constants live in
`src/routes/demo.ts`.

## Dashboard API (session cookie, not API key)

`/api/dashboard/usage` (period usage from D1 ledger), key CRUD via Better Auth client,
`/api/dashboard/billing/checkout` + `/billing/portal` (Stripe redirects).

## Behavioural rules

- Billing guard runs **before** side effects; usage recorded **after** success only
  (per-page in async jobs — a failed page is not billed).
- SSRF guard: public http(s) URLs only — private IP ranges, localhost, and non-standard
  ports are rejected at validation time for every engine, and re-checked in the container
  fetcher (redirect targets included).
- Rate limit: per-key requests/min via Better Auth apiKey rate limiting (initial),
  plus job-level caps above.
