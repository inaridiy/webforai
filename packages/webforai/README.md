<br/>

<p align="center">
  <a href="https://webforai.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://webforai.dev/images/logo-full-dark.svg">
      <img alt="webforai logo" src="https://webforai.dev/images/logo-full-light.svg" width="auto" height="40">
    </picture>
  </a>
</p>

<p align="center">
  Convert web pages and local HTML to clean, LLM-ready Markdown — a dependency-light TypeScript library for Node.js, Cloudflare Workers and browsers.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/webforai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/npm/v/webforai?style=flat">
      <img src="https://img.shields.io/npm/v/webforai?style=flat" alt="Version">
    </picture>
  </a>
  <a href="https://github.com/inaridiy/webforai/blob/main/LICENSE">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/npm/l/webforai?style=flat">
      <img src="https://img.shields.io/npm/l/webforai?style=flat" alt="Apache License">
    </picture>
  </a>
</p>

Documentation: **[webforai.dev](https://webforai.dev)** ([Getting started](https://webforai.dev/getting-started) ·
[API reference](https://webforai.dev/docs/html-to-markdown) · [Embedding in your project](https://webforai.dev/embedding)).

## Install

```bash
npm i webforai
```

```ts
import { htmlToMarkdown } from "webforai";

const url = "https://example.com/article";
const html = await (await fetch(url)).text();

// url selects a site-specific adapter (GitHub, MDN, …) and fills metadata;
// baseUrl resolves relative links
const markdown = htmlToMarkdown(html, { url, baseUrl: url });
```

Looking for the command line? The CLI is a separate package, [`webforai-cli`](https://www.npmjs.com/package/webforai-cli):
`npx webforai-cli <url>`. Up to v4 it shipped inside this package as `npx webforai`.

## Entry points

| Import | What it is | Runs in | Needs |
| --- | --- | --- | --- |
| `webforai` | `htmlToMarkdown` and the conversion API | Node.js, Workers, browsers | nothing |
| `webforai/platform` | typed client for the [hosted platform](https://webforai.dev/platform) | anywhere with `fetch` | nothing |
| `webforai/loaders/fetch` | load HTML over `fetch` | anywhere with `fetch` | nothing |
| `webforai/loaders/playwright` | load JavaScript-rendered pages | Node.js | `npm i playwright-core` |
| `webforai/loaders/puppeteer` | the same with Puppeteer | Node.js | `npm i puppeteer` |
| `webforai/loaders/cf-puppeteer` | the same with Cloudflare Browser Rendering | Workers | `npm i @cloudflare/puppeteer` |

The browser libraries are optional peer dependencies: installing `webforai` never installs them.
The library itself uses no Node.js built-ins, so it can be embedded in other libraries and
bundled for Workers or browsers; [Embedding in your project](https://webforai.dev/embedding)
lists its dependencies and bundle size.

s).

## What you get

- **Main content only.** Navigation, ads and footers are dropped. Pages are first matched
  against site adapters; every other page goes through **kiwame**, a small built-in learned
  classifier (plain TypeScript, no WASM, runs in a Cloudflare Worker). See
  [How it works](https://webforai.dev/how-it-works) for the model, the benchmark and how to switch
  back to the heuristic extractor.
- **Agent mode.** `agentExtractor` returns the same main content followed by the page's other
  links grouped by role (related, pagination, section navigation, breadcrumb, site navigation),
  so an agent can decide where to go next; `--extractor agent` on the CLI, and
  `convert: { extractor: "agent" }` on the hosted platform.
- **Site adapters** for GitHub, Stack Overflow, npm, MDN, Zenn, Qiita, Medium, Substack, note,
  Hatena, WordPress, Wikipedia, Reddit, YouTube, Hacker News, Docusaurus, VitePress, MkDocs,
  Read the Docs and GitBook — matched by hostname or by a platform fingerprint, so self-hosted
  instances are covered too. An adapter that produces too little falls back to generic
  extraction, so a site redesign degrades rather than breaks.
- **Page metadata** as data or as YAML front matter:

  ```ts
  import { htmlToMarkdown, htmlToMarkdownWithMetadata } from "webforai";

  const { markdown, metadata, extraction } = htmlToMarkdownWithMetadata(html, { url });
  // metadata: { title, author, published, siteName, canonicalUrl, lang, ... }
  // extraction: { extractor: "kiwame" | "takumi" | "adapter", confidence?: 0..1 }

  const withFrontmatter = htmlToMarkdown(html, { url, frontmatter: true });
  ```

- **Markup that survives conversion**: lazily-loaded images, KaTeX/MathJax, code blocks and tabs,
  tables, definition lists, and superscripts/subscripts.

Release notes and breaking changes are in the
[CHANGELOG](https://github.com/inaridiy/webforai/blob/main/packages/webforai/CHANGELOG.md).

## Platform (hosted API)

webforai platform runs the browsers, proxies and crawl queues for you and returns the same
Markdown as the library. It includes 1,000 free credits a month; sign up and create an API key
at [platform.webforai.dev](https://platform.webforai.dev).

```ts
import { createPlatformClient } from "webforai/platform";

const platform = createPlatformClient({ apiKey: process.env.WEBFORAI_API_KEY });
const page = await platform.scrape({ url: "https://example.com/article" });
page.markdown;
```

See the [platform docs](https://webforai.dev/platform) for the API reference and
[billing](https://webforai.dev/platform/billing).

## Support

- [GitHub Sponsors](https://github.com/sponsors/inaridiy)
- [@inaridiy on X](https://x.com/inaridiy)

## License

[Apache 2.0](https://github.com/inaridiy/webforai/blob/main/LICENSE)
