<br/>

<p align="center">
  <a href="https://webforai.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/inaridiy/webforai/main/site/docs/public/images/readme-logo-dark.svg">
      <img alt="webforai" src="https://raw.githubusercontent.com/inaridiy/webforai/main/site/docs/public/images/readme-logo-light.svg" width="auto" height="60">
    </picture>
  </a>
</p>

<h3 align="center">Any HTML to the cleanest Markdown, for humans and AI agents.</h3>

<p align="center">
  <b>Best quality</b> · <b>Most token-efficient</b> · <b>Near-top speed</b> · <b>Pure TypeScript</b>
</p>

<p align="center">
  <b>Reader mode</b> extracts the main content of a page, like Mozilla Readability, with the best
  quality of the converters we benchmarked. <b>Agent mode</b> adds only the links an AI agent needs
  to explore the site, for about half the tokens of converting the whole page. Both are measured
  against other converters <a href="#benchmarks">below</a>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/webforai"><img src="https://img.shields.io/npm/v/webforai?style=flat&color=1f8fff" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/webforai"><img src="https://img.shields.io/npm/dm/webforai?style=flat&color=1f8fff" alt="npm downloads"></a>
  <a href="https://github.com/inaridiy/webforai/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/webforai?style=flat" alt="Apache-2.0"></a>
</p>

<p align="center">
  <a href="https://webforai.dev/#demo"><b>Try it live</b></a> ·
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

const markdown = htmlToMarkdown(html, { url }); // Reader mode
const forAgents = htmlToMarkdown(html, { url, extractors: presetExtractors("agent") }); // Agent mode
```

From the shell: [`webforai-cli`](https://www.npmjs.com/package/webforai-cli), `npx webforai-cli <url>`,
with `--extractor agent` for agent mode (up to v4 it shipped in this package as `npx webforai`).
For pages that need a browser or a proxy, use the [hosted platform](#hosted-platform).

## What you get

Agent mode on [vite.dev/guide/env-and-mode](https://vite.dev/guide/env-and-mode) (abridged):

````md
# Env Variables and Modes

Vite exposes certain constants under the special `import.meta.env` object. These constants are
defined as global variables during dev and statically replaced at build time to make tree-shaking
effective.

```js
if (import.meta.env.DEV) {
  // code inside here will be tree-shaken in production builds
  console.log('Dev mode')
}
```

## Built-in Constants

- **`import.meta.env.MODE`**: {string} the [mode](#modes) the app is running in.
- **`import.meta.env.BASE_URL`**: {string} the base url the app is being served from. …

…

## Links

### Pagination

- [Previous page Deploying a Static Site](https://vite.dev/guide/static-deploy)
- [Next page Server-Side Rendering (SSR)](https://vite.dev/guide/ssr)

### Section navigation

- [Getting Started](https://vite.dev/guide/)
- [Features](https://vite.dev/guide/features)
- [Building for Production](https://vite.dev/guide/build)
- …
````

- **Reader mode** (default) returns the article alone, up to `## Links`: for reading, summarising,
  RAG and embeddings.
- **Agent mode** adds the `## Links` section — related, pagination, section and site navigation,
  breadcrumbs — so an agent can decide which page to open next.
- Code blocks keep their language, tables stay GFM tables, KaTeX and MathJax become LaTeX, and
  lazy-loaded images come through. Page metadata (title, author, published, …) comes from
  `htmlToMarkdownWithMetadata` or as YAML front matter with `frontmatter: true`.

## Benchmarks

### Reader mode: main content

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/inaridiy/webforai/main/site/docs/public/images/benchmark-dark.svg">
  <img alt="WCEB F1: webforai 0.923 with the comments preset (0.891 default), Trafilatura 0.900, Readability + Turndown 0.880, Defuddle 0.820, Firecrawl OSS 0.743, Cloudflare toMarkdown 0.713. Code blocks kept: webforai 98%, Readability + Turndown 46%, Defuddle 89%, Trafilatura 41%. Time for 60 pages: webforai 4.0 s, Readability + Turndown 13.7 s, Defuddle 13.8 s, Trafilatura 2.9 s (Python)" src="https://raw.githubusercontent.com/inaridiy/webforai/main/site/docs/public/images/benchmark-light.svg" width="100%">
</picture>

F1 on [WCEB](https://github.com/chatnoir-eu/web-content-extraction-benchmark), 3,985 pages:
webforai **0.923** (keeping reader comments, as Trafilatura does), Trafilatura 0.900,
Readability + Turndown 0.880, Defuddle 0.820. webforai keeps 98% of code blocks;
Readability + Turndown keeps 46%. It converts 60 pages in 4.0 s where Readability + Turndown
takes 13.7 s. [Method and configurations →](https://webforai.dev/benchmarks)

### Agent mode: following links

290 tasks ask a model to follow a related or next article to answer a question. How often it
picks the right link, and how many tokens it was given:

| Output given to the model | Right link chosen (Haiku 5.5 / Sonnet 5.5) | Median tokens |
| --- | ---: | ---: |
| webforai, agent mode | 93.8% / 94.1% | **2,426** |
| Whole page, Turndown | 92.9% / 94.8% | 4,533 |
| Whole page, node-html-markdown | 92.6% / 94.5% | 4,350 |

Same accuracy, about half the tokens.
[Method and task list →](https://webforai.dev/benchmarks#following-links-agent-mode)

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
