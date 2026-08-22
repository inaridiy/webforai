# @webforai/platform

Typed, dependency-free client for the [webforai platform](https://webforai.dev/platform) —
the hosted crawl→Markdown HTTP API built on the [webforai](https://www.npmjs.com/package/webforai)
library. Works anywhere `fetch` exists: Node ≥18, browsers, edge runtimes.

```bash
npm i @webforai/platform
```

## Usage

Create an API key on the [dashboard](https://platform.webforai.dev/dashboard), then:

```ts
import { createPlatformClient } from "@webforai/platform";

const platform = createPlatformClient({ apiKey: process.env.WEBFORAI_API_KEY });

// Synchronous: one URL in, Markdown out
const page = await platform.scrape({ url: "https://example.com/article", engine: "browser" });
console.log(page.markdown, page.metadata, page.credits);

// Async jobs: batch and crawl
const { jobId } = await platform.crawl({ url: "https://docs.example.com/", maxDepth: 2, limit: 50 });
await platform.waitForJob(jobId, { onStatus: (s) => console.log(s.status, `${s.completed}/${s.total}`) });
for await (const result of platform.jobResults(jobId)) {
  if (result.status === "ok") {
    console.log(result.url, result.markdown.length);
  }
}
```

Engines: `fetch` (1 credit), `browser` (5, screenshots), `proxy-fetch` (2),
`proxy-browser` (5, screenshots). Optional per-request `region` (`us`/`eu`/`uk`/`jp`/`asia`)
for the proxy engines, `screenshot`, `rehostImages`, and `convert` options
(`extractor`, `frontmatter`, `baseUrl`).

Self-hosting the platform? Point the client at your deployment:

```ts
const platform = createPlatformClient({ apiKey, baseUrl: "https://platform.your.domain" });
```

## Errors

Every non-2xx API response throws a `PlatformApiError` with `code`, `status` and optional
`retryAfter` (seconds). Useful codes: `invalid_api_key` (401), `payment_required` (402),
`rate_limited` (429), `engine_unavailable` (503). The client never retries by itself.

```ts
import { PlatformApiError } from "@webforai/platform";

try {
  await platform.scrape({ url });
} catch (error) {
  if (error instanceof PlatformApiError && error.code === "payment_required") {
    // out of credits
  }
}
```

## Documentation

Full API reference: [webforai.dev/platform/api-reference](https://webforai.dev/platform/api-reference).
The platform itself is open source and self-hostable — see
[`apps/platform`](https://github.com/inaridiy/webforai/tree/main/apps/platform).

## License

[Apache 2.0](https://github.com/inaridiy/webforai/blob/main/LICENSE)
