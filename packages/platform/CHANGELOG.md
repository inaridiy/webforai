# @webforai/platform

## 0.1.0

### Minor Changes

- [`e0a6428`](https://github.com/inaridiy/webforai/commit/e0a642840f7e180d71f56b10f4cc0e56c73d6f9e) Thanks [@inaridiy](https://github.com/inaridiy)! - Initial release: a typed, dependency-free client for the webforai platform API. Covers
  `scrape` (sync and async), `batch`, `crawl`, job status/results with cursor paging,
  `waitForJob` polling, a `jobResults` async iterator that transparently downloads spilled
  results, and the keyless `demoScrape`. Errors surface as `PlatformApiError` with the API's
  `code`/`status`/`retryAfter`. All I/O goes through an injectable, structurally-typed `fetch`
  (`FetchLike`) so the client runs unchanged behind Cloudflare Workers service bindings,
  undici/node-fetch, or test stubs, independent of which fetch typings the consumer compiles
  with.
