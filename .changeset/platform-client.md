---
"webforai": minor
---

New `webforai/platform` subpath: a typed, dependency-free client for the hosted
webforai platform API. Covers `scrape` (sync and async), `batch`, `crawl`, job
status/results with cursor paging, `waitForJob` polling, a `jobResults` async iterator
that transparently downloads spilled results, and the keyless `demoScrape`. Errors
surface as `PlatformApiError` with the API's `code`/`status`/`retryAfter`. All I/O goes
through an injectable, structurally-typed `fetch` (`FetchLike`) so the client runs
unchanged behind Cloudflare Workers service bindings, undici/node-fetch, or test stubs.
