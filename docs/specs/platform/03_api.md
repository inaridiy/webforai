# Platform API

Revision note (2026-08-10): Initial version.

Auth: `Authorization: Bearer <api key>` (Better Auth apiKey plugin). All bodies JSON.
Errors: `{ error: { code, message } }` with proper status; failed operations are never billed.

## POST /v1/scrape — synchronous, single URL

Runs on the plain Worker (fast, not durable). With `"async": true` it instead enqueues a
1-URL job (same shape as batch) and returns `202 { jobId }`.

```jsonc
{
  "url": "https://example.com/article",
  "engine": "fetch",            // fetch | proxy-fetch | proxy-browser | cf-browser
  "screenshot": false,           // proxy-browser / cf-browser only (400 otherwise)
  "rehostImages": false,
  "async": false,
  "convert": {                   // passthrough to webforai (all optional)
    "extractor": "auto",        // auto | takumi | minimal | none
    "frontmatter": true,
    "baseUrl": "..."
  }
}
```

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
  "rehostImages": false, "convert": { } }
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
  "screenshot": false, "rehostImages": false, "convert": { }
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

Paged page-results; each item mirrors the sync scrape response plus
`{ "status": "ok" | "error", "error": {...} }`. Large markdown may be replaced by
`{ "resultUrl": "<expiring R2 url>" }`.

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
