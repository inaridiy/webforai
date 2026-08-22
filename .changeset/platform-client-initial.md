---
"@webforai/platform": minor
---

Initial release: a typed, dependency-free client for the webforai platform API. Covers
`scrape` (sync and async), `batch`, `crawl`, job status/results with cursor paging,
`waitForJob` polling, a `jobResults` async iterator that transparently downloads spilled
results, and the keyless `demoScrape`. Errors surface as `PlatformApiError` with the API's
`code`/`status`/`retryAfter`.
