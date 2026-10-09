<br/>

<p align="center">
  <a href="https://webforai.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://webforai.dev/images/logo-full-dark.svg">
      <img alt="webforai" src="https://webforai.dev/images/logo-full-light.svg" width="auto" height="44">
    </picture>
  </a>
</p>

<h3 align="center">Any web page, as clean Markdown for LLMs.</h3>

<p align="center">
  Main content only — no navigation, ads or cookie banners. A dependency-light TypeScript library
  for Node.js, Cloudflare Workers and browsers.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/webforai"><img src="https://img.shields.io/npm/v/webforai?style=flat&color=1f8fff" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/webforai"><img src="https://img.shields.io/npm/dm/webforai?style=flat&color=1f8fff" alt="npm downloads"></a>
  <a href="https://github.com/inaridiy/webforai/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/webforai?style=flat" alt="Apache-2.0"></a>
</p>

<p align="center">
  <a href="https://webforai.dev/getting-started"><b>Docs</b></a> ·
  <a href="https://webforai.dev/docs/html-to-markdown"><b>API reference</b></a> ·
  <a href="https://webforai.dev/benchmarks"><b>Benchmarks</b></a> ·
  <a href="https://github.com/inaridiy/webforai"><b>GitHub</b></a>
</p>

<br/>

```bash
npm i webforai
```

```ts
import { htmlToMarkdown } from "webforai";

const url = "https://example.com/article";
const html = await (await fetch(url)).text();

// url selects a site adapter (GitHub, MDN, …) and fills metadata; baseUrl resolves relative links
const markdown = htmlToMarkdown(html, { url, baseUrl: url });
```

Looking for the command line? That is [`webforai-cli`](https://www.npmjs.com/package/webforai-cli):
`npx webforai-cli <url>`. Up to v4 it shipped inside this package as `npx webforai`.

## Benchmarks

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/inaridiy/webforai/main/site/docs/public/images/benchmark-dark.svg">
  <img alt="WCEB F1: webforai 0.892, Readability + Turndown 0.880, Defuddle 0.820, Firecrawl OSS 0.743, Cloudflare toMarkdown 0.713. Code blocks kept: 98%, 46%, 89%, 52%, 54%. Time for 60 pages: webforai 4.0 s, Readability + Turndown 13.1 s, Defuddle 14.0 s" src="https://raw.githubusercontent.com/inaridiy/webforai/main/site/docs/public/images/benchmark-light.svg" width="100%">
</picture>

WCEB scores extracted text against reference text on 3,985 pages and is never used for tuning.
Code blocks and time come from 60 real pages that webforai is developed against, so they likely
favour it. Firecrawl OSS and Cloudflare toMarkdown run as services and are not timed. Method and
limitations: [webforai.dev/benchmarks](https://webforai.dev/benchmarks).

## Entry points

| Import | What it is | Runs in | Your project adds |
| --- | --- | --- | --- |
| `webforai` | `htmlToMarkdown` and the conversion API | Node.js, Workers, browsers | nothing |
| `webforai/platform` | typed client for the [hosted platform](https://webforai.dev/platform) | anywhere with `fetch` | nothing |
| `webforai/loaders/fetch` | load HTML over `fetch` | anywhere with `fetch` | nothing |
| `webforai/loaders/playwright` | load JavaScript-rendered pages | Node.js | `playwright-core` |
| `webforai/loaders/puppeteer` | the same with Puppeteer | Node.js | `puppeteer` |
| `webforai/loaders/cf-puppeteer` | the same with Cloudflare Browser Rendering | Workers | `@cloudflare/puppeteer` |

Browser drivers are optional peer dependencies: installing `webforai` never installs them. The
library uses no Node.js built-ins, installs as about 100 packages (14 MB), and runs in Workers
without `nodejs_compat`; [Embedding in your project](https://webforai.dev/embedding) has the
details and bundle sizes.

## What you get

- **Main content, found by a model.** Site adapters first, then **kiwame**, a small learned block
  classifier in plain TypeScript (no WASM, no network calls).
  [How it works →](https://webforai.dev/how-it-works)
- **Twenty site adapters**: GitHub, Stack Overflow, npm, MDN, Wikipedia, Reddit, YouTube,
  Hacker News, Medium, Substack, Zenn, Qiita, note, Hatena, WordPress, Docusaurus, VitePress,
  MkDocs, Read the Docs and GitBook. Matched by hostname or platform fingerprint, with generic
  extraction as the fallback when a site changes.
- **Markup that survives**: code blocks with their language (tabs and Twoslash included), GFM
  tables, KaTeX/MathJax as LaTeX, lazy-loaded images, definition lists, sub/superscripts.
- **Agent mode**: `agentExtractor` appends the page's other links grouped by role (related,
  pagination, section navigation, breadcrumbs).
- **Metadata** as data or YAML front matter:

  ```ts
  import { htmlToMarkdown, htmlToMarkdownWithMetadata } from "webforai";

  const { markdown, metadata, extraction } = htmlToMarkdownWithMetadata(html, { url });
  // metadata: { title, author, published, siteName, canonicalUrl, lang, ... }
  // extraction: { extractor: "kiwame" | "takumi" | "adapter", confidence?: 0..1 }

  const withFrontmatter = htmlToMarkdown(html, { url, frontmatter: true });
  ```

## Hosted platform

When you need JavaScript rendering, proxies or whole-site crawls, the
[webforai platform](https://platform.webforai.dev) runs them and returns the same Markdown
(1,000 free credits a month). The typed client ships in this package:

```ts
import { createPlatformClient } from "webforai/platform";

const platform = createPlatformClient({ apiKey: process.env.WEBFORAI_API_KEY });
const page = await platform.scrape({ url: "https://example.com/article" });
page.markdown;
```

## Links

- [Changelog](https://github.com/inaridiy/webforai/blob/main/packages/webforai/CHANGELOG.md) ·
  [GitHub Sponsors](https://github.com/sponsors/inaridiy) · [@inaridiy on X](https://x.com/inaridiy)
- License: [Apache 2.0](https://github.com/inaridiy/webforai/blob/main/LICENSE)
