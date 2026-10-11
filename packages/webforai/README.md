<br/>

<p align="center">
  <a href="https://webforai.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/inaridiy/webforai/main/site/docs/public/images/readme-logo-dark.svg">
      <img alt="webforai" src="https://raw.githubusercontent.com/inaridiy/webforai/main/site/docs/public/images/readme-logo-light.svg" width="auto" height="60">
    </picture>
  </a>
</p>

<h3 align="center">Any web page, as clean Markdown for LLMs.</h3>

<p align="center">
  <b>Readability mode</b> keeps the main content only — no navigation, ads or cookie banners.
  <b>Agent mode</b> adds the links an agent needs to go on, grouped by role. A dependency-light
  TypeScript library for Node.js, Cloudflare Workers and browsers.
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
import { htmlToMarkdown, presetExtractors } from "webforai";

const url = "https://example.com/article";
const html = await (await fetch(url)).text();

// url picks a site adapter and fills metadata; baseUrl makes relative links absolute
const markdown = htmlToMarkdown(html, { url, baseUrl: url });
const forAgents = htmlToMarkdown(html, { url, baseUrl: url, extractors: presetExtractors("agent") });
```

Two modes:

| | **Readability mode** (default) | **Agent mode** |
| --- | --- | --- |
| Output | The page's main content | The main content, then reader comments and the page's other links grouped by role (related, pagination, section and site navigation, breadcrumbs) |
| For | Reading, summarising, RAG and embeddings | Agents that browse and decide which link to open next |
| Call | `htmlToMarkdown(html, { url })` | `htmlToMarkdown(html, { url, extractors: presetExtractors("agent") })` |

The `comments` preset sits between them: main content and reader comments, without the links.
[All presets →](https://webforai.dev/docs/html-to-markdown#optionsextractors)

Looking for the command line? That is [`webforai-cli`](https://www.npmjs.com/package/webforai-cli):
`npx webforai-cli <url>`. Up to v4 it shipped inside this package as `npx webforai`.

## Benchmarks

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/inaridiy/webforai/main/site/docs/public/images/benchmark-dark.svg">
  <img alt="WCEB F1: webforai 0.891 (0.923 with the comments preset), Readability + Turndown 0.880, Defuddle 0.820, Trafilatura 0.900, Firecrawl OSS 0.743, Cloudflare toMarkdown 0.713. Code blocks kept: 98%, 46%, 89%, 41%, 52%, 54%. Time for 60 pages: webforai 4.0 s, Readability + Turndown 13.7 s, Defuddle 13.8 s, Trafilatura 2.9 s (Python)" src="https://raw.githubusercontent.com/inaridiy/webforai/main/site/docs/public/images/benchmark-light.svg" width="100%">
</picture>

**Readability mode.** WCEB scores extracted text against reference text on 3,985 pages.
webforai's score is with the `comments` preset, which keeps reader comments as Trafilatura does;
the default preset scores 0.891. Code blocks and time come from 60 cached real pages.

**Agent mode** keeps the links a model needs to go on. On 290 tasks that follow a related or next
article, Haiku 5.5 and Sonnet 5.5 picked the right link from its output 93.8% and 94.1% of the
time, as often as from the whole page converted by node-html-markdown (92.6%, 94.5%), at 2,426
median tokens against 4,350. Method and limitations:
[webforai.dev/benchmarks](https://webforai.dev/benchmarks).

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
library uses no Node.js built-ins, is ~300 KB gzipped in a Worker, and runs there without
`nodejs_compat`; [Embedding in your project](https://webforai.dev/embedding) has the
details and bundle sizes.

## What you get

- **Main content, found by a small model.** Site adapters first, then **kiwame**, a learned block
  classifier in plain TypeScript (no LLM calls, no WASM, no network calls).
  [How it works →](https://webforai.dev/how-it-works)
- **Site adapters** for GitHub, Stack Overflow, npm, Wikipedia, Reddit, YouTube, Hacker News,
  Medium, Substack, Zenn, Qiita, note, Hatena, WordPress, Docusaurus, VitePress, MkDocs, Read the
  Docs and GitBook. Matched by hostname or platform fingerprint, with generic
  extraction as the fallback when a site changes.
- **Markup that survives**: code blocks with their language (tabs and Twoslash included), GFM
  tables, KaTeX/MathJax as LaTeX, lazy-loaded images, definition lists, sub/superscripts.
- **Agent mode**: `agentExtractor` appends the page's other links grouped by role (related,
  pagination, section and site navigation, breadcrumbs).
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
