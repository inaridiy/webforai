<br/>

<p align="center">
  <a href="https://webforai.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="site/docs/public/images/readme-logo-dark.svg">
      <img alt="webforai" src="site/docs/public/images/readme-logo-light.svg" width="auto" height="60">
    </picture>
  </a>
</p>

<h3 align="center">Any HTML to the cleanest Markdown, for humans and AI agents.</h3>

<p align="center">
  <b>Half as many lost pages</b> · <b>98% of code blocks kept</b> · <b>Half the tokens for agents</b> · <b>Pure TypeScript</b>
</p>

<p align="center">
  <b>Reader mode</b> extracts the main content of a page, like Mozilla Readability, and loses the
  page about half as often as the extractors we compared it with. <b>Agent mode</b> adds only the
  links an AI agent needs to explore the site, for about half the tokens of converting the whole
  page. Both are measured against other converters <a href="#benchmarks">below</a>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/webforai"><img src="https://img.shields.io/npm/v/webforai?style=flat&color=1f8fff" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/webforai"><img src="https://img.shields.io/npm/dm/webforai?style=flat&color=1f8fff" alt="npm downloads"></a>
  <a href="https://github.com/inaridiy/webforai/actions/workflows/ci.yaml"><img src="https://github.com/inaridiy/webforai/actions/workflows/ci.yaml/badge.svg" alt="CI"></a>
  <a href="https://github.com/inaridiy/webforai/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/webforai?style=flat" alt="Apache-2.0"></a>
</p>

<p align="center">
  <a href="https://webforai.dev/#demo"><b>Try it live</b></a> ·
  <a href="https://webforai.dev/getting-started"><b>Docs</b></a> ·
  <a href="https://webforai.dev/benchmarks"><b>Benchmarks</b></a> ·
  <a href="https://webforai.dev/cli"><b>CLI</b></a> ·
  <a href="https://platform.webforai.dev"><b>Hosted API</b></a>
</p>

<br/>

## Quick start

```bash
npm i webforai
```

```ts
import { htmlToMarkdown, presetExtractors } from "webforai";

const url = "https://vite.dev/guide/env-and-mode";
const html = await (await fetch(url)).text();

const markdown = htmlToMarkdown(html, { url }); // Reader mode: the main content
const forAgents = htmlToMarkdown(html, { url, extractors: presetExtractors("agent") }); // Agent mode: + the links
```

<details>
<summary><b>What you get</b> — <code>forAgents</code> for that page, abridged</summary>
<br/>

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

</details>

- **Reader mode** (default) returns the article alone, up to `## Links`: for reading, summarising,
  RAG and embeddings.
- **Agent mode** adds the `## Links` section — related, pagination, section and site navigation,
  breadcrumbs — so an agent can decide which page to open next.
- The Markdown reads as the page does: code blocks keep their lines and language, tables stay GFM
  tables, notes and warnings become block quotes, links are absolute, KaTeX and MathJax become
  LaTeX, and lazy-loaded images come through.
- Pages that hide their content from a plain fetch still convert: forum threads shipped inside
  `<noscript>`, and the parts Next.js or GitBook stream after the page's shell.
- Page metadata (title, author, published, …) comes from `htmlToMarkdownWithMetadata` or as YAML
  front matter with `frontmatter: true`.
- The snippet runs as-is in Node.js, Cloudflare Workers and browsers: the library uses no Node.js
  built-ins and fetches nothing itself. Browser loaders (Playwright, Puppeteer) are optional.

From the shell: `npx webforai-cli <url>`, with `--extractor agent` for agent mode. For pages that
need a browser or a proxy, use the [hosted API](#ways-to-use). With nothing installed,
`https://platform.webforai.dev/https://example.com/article` returns that page as Markdown (a
rate-limited demo without a key). Coding agents learn the CLI from its Agent Skill:
`npx skills add inaridiy/webforai`, or as a plugin in Claude Code
(`/plugin install webforai --marketplace inaridiy/webforai`), Codex
(`codex plugin marketplace add inaridiy/webforai`) and pi (`pi install npm:webforai-cli`).

## Benchmarks

Measured against other converters on the same pages.
[Method, configurations and limitations →](https://webforai.dev/benchmarks)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="site/docs/public/images/benchmark-dark.svg">
  <img alt="On 511 held-out WCXB pages, F1: webforai 0.877, Trafilatura 0.860, Defuddle 0.855, Readability + Turndown 0.831. Pages that lose half their content on WebMainBench: webforai 5.1%, Trafilatura 10.2%, Defuddle 11.5%, Readability + Turndown 12.6%. Code blocks kept on 60 pages: webforai 98%, Trafilatura 41%, Defuddle 90%, Readability + Turndown 45%" src="site/docs/public/images/benchmark-light.svg" width="100%">
</picture>

### Reader mode: is the page kept?

Every extractor returns most pages well; they differ in how many they get wrong. On
[WebMainBench](https://arxiv.org/abs/2511.23119) (7,809 annotated pages) webforai
loses half of the content on **5.1%** of pages; Trafilatura, Defuddle and Readability + Turndown
on 10–13%. On the 511 held-out pages of [WCXB](https://arxiv.org/abs/2605.21097) — articles,
forums, products, listings, documentation — its F1 is **0.877** against 0.860, 0.855 and 0.831.
On [WCEB](https://github.com/chatnoir-eu/web-content-extraction-benchmark), 3,985 older news
pages, it scores 0.896, level with Trafilatura's 0.900, and 0.924 when reader comments are kept
as Trafilatura keeps them.

### Reader mode: is the Markdown good to read?

Scores against reference text only count words. webforai keeps **98%** of code blocks as code
blocks; Readability + Turndown keeps 45%. Shown two conversions of the same page with the names
hidden, on 105 held-out pages, two models both prefer webforai's Markdown to Readability +
Turndown's on seven pages in ten (72% to 20%, and 71% to 22%). Against Defuddle neither has a
clear preference (51% to 38%, and 51% to 41%). Converting is about three times faster than
either.

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

## Ways to use

| | Install | Use it for |
| --- | --- | --- |
| **Library** — [`webforai`](https://www.npmjs.com/package/webforai) | `npm i webforai` | HTML you already have, in your own code. Node.js (ESM and CommonJS), Cloudflare Workers and browsers; ~300 KB gzipped in a Worker. [Getting started →](https://webforai.dev/getting-started) |
| **CLI** — [`webforai-cli`](https://www.npmjs.com/package/webforai-cli) | `npx webforai-cli <url>` | The shell, scripts and AI agents (it ships an Agent Skill). [CLI →](https://webforai.dev/cli) |
| **Hosted API** — [webforai platform](https://platform.webforai.dev) | API key | JavaScript rendering, proxies, and crawling whole sites to Markdown and `llms.txt`. 1,000 free credits a month. [Platform docs →](https://webforai.dev/platform) |

The library fetches nothing by itself: pass it HTML, or load pages with `webforai/loaders/fetch`,
`webforai/loaders/playwright` (add `playwright-core`) or the
[other loaders](https://webforai.dev/docs/loaders).

## Contributing

Issues and pull requests are welcome. `pnpm install`, then `pnpm run test --run` and
`pnpm build`; [AGENTS.md](AGENTS.md) describes the layout of the repository and its conventions.
The library ([`packages/webforai`](packages/webforai)), the CLI ([`packages/cli`](packages/cli))
and the platform ([`apps/platform`](apps/platform)) all live here, and release notes are in the
[CHANGELOG](packages/webforai/CHANGELOG.md).

## Support

- [GitHub Sponsors](https://github.com/sponsors/inaridiy)
- [@inaridiy on X](https://x.com/inaridiy)

## License

[Apache 2.0](LICENSE)
