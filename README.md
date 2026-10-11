<br/>

<p align="center">
  <a href="https://webforai.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="site/docs/public/images/readme-logo-dark.svg">
      <img alt="webforai" src="site/docs/public/images/readme-logo-light.svg" width="auto" height="60">
    </picture>
  </a>
</p>

<h3 align="center">Any web page, as clean Markdown for LLMs.</h3>

<p align="center">
  <b>Reader mode</b> keeps the main content only — no navigation, ads or cookie banners.
  <b>Agent mode</b> adds the links an agent needs to go on, grouped by role. The highest score on
  the WCEB extraction benchmark of the converters we tested, and small enough to run in a
  Cloudflare Worker or a browser.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/webforai"><img src="https://img.shields.io/npm/v/webforai?style=flat&color=1f8fff" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/webforai"><img src="https://img.shields.io/npm/dm/webforai?style=flat&color=1f8fff" alt="npm downloads"></a>
  <a href="https://github.com/inaridiy/webforai/actions/workflows/ci.yaml"><img src="https://github.com/inaridiy/webforai/actions/workflows/ci.yaml/badge.svg" alt="CI"></a>
  <a href="https://github.com/inaridiy/webforai/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/webforai?style=flat" alt="Apache-2.0"></a>
</p>

<p align="center">
  <a href="https://webforai.dev/getting-started"><b>Docs</b></a> ·
  <a href="https://webforai.dev/benchmarks"><b>Benchmarks</b></a> ·
  <a href="https://webforai.dev/cli"><b>CLI</b></a> ·
  <a href="https://platform.webforai.dev"><b>Hosted API</b></a>
</p>

<br/>

```bash
npx webforai-cli https://example.com/article
```

```ts
import { htmlToMarkdown, presetExtractors } from "webforai";

const markdown = htmlToMarkdown(html, { url }); // Reader mode
const forAgents = htmlToMarkdown(html, { url, extractors: presetExtractors("agent") }); // Agent mode
```

## Two modes

| | **Reader mode** (default) | **Agent mode** |
| --- | --- | --- |
| Output | The page's main content: the article, docs page or post | The same main content, then reader comments and the page's other links grouped by role: related, pagination, section and site navigation, breadcrumbs |
| For | Reading, summarising, RAG and embeddings | Agents that browse and decide which link to open next |
| Library | `htmlToMarkdown(html, { url })` | `htmlToMarkdown(html, { url, extractors: presetExtractors("agent") })` |
| CLI | `npx webforai-cli <url>` | `npx webforai-cli <url> --extractor agent` |
| Benchmark | [Main content →](#reader-mode-main-content) | [Following links →](#agent-mode-following-links) |

The `comments` preset sits between the two: the main content and reader comments, without the
links. Every preset works in the library, the CLI and the hosted API.
[All presets →](https://webforai.dev/docs/html-to-markdown#optionsextractors)

## Benchmarks

### Reader mode: main content

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="site/docs/public/images/benchmark-dark.svg">
  <img alt="WCEB F1: webforai 0.891 (0.923 with the comments preset), Readability + Turndown 0.880, Defuddle 0.820, Trafilatura 0.900, Firecrawl OSS 0.743, Cloudflare toMarkdown 0.713. Code blocks kept: 98%, 46%, 89%, 41%, 52%, 54%. Time for 60 pages: webforai 4.0 s, Readability + Turndown 13.7 s, Defuddle 13.8 s, Trafilatura 2.9 s (Python)" src="site/docs/public/images/benchmark-light.svg" width="100%">
</picture>

[WCEB](https://github.com/chatnoir-eu/web-content-extraction-benchmark) (Bevendorff et al., SIGIR 2023)
scores extracted text against reference text on 3,985 pages. webforai's score is with the
`comments` preset, which keeps reader comments as Trafilatura does; the default preset scores
0.891. Code blocks and time come from 60 cached real pages. Method, configurations and limitations
are on the [benchmarks page](https://webforai.dev/benchmarks), and everything is reproducible from
[`evals/`](evals).

### Agent mode: following links

On 290 tasks that ask a model to follow a related or next article to answer a question, the
model picks the right link from agent mode's output as often as from the whole page, with about
half the tokens:

| Output given to the model | Right link chosen (Haiku 5.5 / Sonnet 5.5) | Median tokens |
| --- | ---: | ---: |
| webforai, agent mode | 93.8% / 94.1% | **2,426** |
| webforai + every link of the page | 92.5% / 94.5% | 2,902 |
| Turndown (full page) | 92.9% / 94.8% | 4,533 |
| node-html-markdown (full page) | 92.6% / 94.5% | 4,350 |
| Readability + Turndown, Defuddle, Trafilatura | 5–12% | 900–1,100 |

Reader-mode extractors drop the links around the article, as they are designed to.
[Method and task list →](https://webforai.dev/benchmarks#following-links-agent-mode)

## Why webforai

- **Main content, found by a small model.** Pages go through site adapters first, then
  **kiwame**, a learned block classifier written in plain TypeScript: no LLM calls, no WASM, no
  native code, no network calls. [How it works →](https://webforai.dev/how-it-works)
- **Site adapters** for GitHub, Stack Overflow, npm, Wikipedia, Reddit, YouTube, Hacker News,
  Medium, Substack, Zenn, Qiita, note, Hatena, WordPress, Docusaurus, VitePress, MkDocs, Read the
  Docs and GitBook. They match by hostname or by platform fingerprint, so self-hosted instances
  are covered, and fall back to generic extraction when a site changes.
- **Markup that survives.** Code blocks keep their language, including tabbed and
  Twoslash-annotated code. Tables stay GFM tables, KaTeX and MathJax become LaTeX, and
  lazy-loaded images, definition lists and sub/superscripts come through. Metadata comes back as
  data or YAML front matter.
- **Built for agents.** Agent mode appends the page's other links, grouped by role (related,
  pagination, section and site navigation, breadcrumbs). A model finds the next page in it as
  reliably as in the whole page, from
  [about half the tokens](#agent-mode-following-links).
- **Easy to embed.** ~300 KB gzipped in a Worker, with no browser driver and no Node.js
  built-ins. It runs in Node.js (ESM and CommonJS), Cloudflare Workers (no `nodejs_compat`)
  and browsers. [Embedding in your project →](https://webforai.dev/embedding)

## Three ways to use it

| | Install | Use it for |
| --- | --- | --- |
| **Library** — [`webforai`](https://www.npmjs.com/package/webforai) | `npm i webforai` | HTML you already have, in your own code. [Getting started →](https://webforai.dev/getting-started) |
| **CLI** — [`webforai-cli`](https://www.npmjs.com/package/webforai-cli) | `npx webforai-cli <url>` | The shell, scripts and AI agents (it ships an Agent Skill). Up to v4 this was `npx webforai`. [CLI →](https://webforai.dev/cli) |
| **Hosted API** — [webforai platform](https://platform.webforai.dev) | API key | JavaScript rendering, proxies, and crawling whole sites to Markdown and `llms.txt`. 1,000 free credits a month. [Platform docs →](https://webforai.dev/platform) |

The library fetches nothing by itself. Pass it HTML, or load pages with
`webforai/loaders/fetch`, `webforai/loaders/playwright` (add `playwright-core`) or the
[other loaders](https://webforai.dev/docs/loaders):

```ts
import { htmlToMarkdownWithMetadata } from "webforai";
import { loadHtml } from "webforai/loaders/fetch";

const url = "https://example.com/article";
// url picks a site adapter and fills metadata; baseUrl makes relative links absolute
const { markdown, metadata } = htmlToMarkdownWithMetadata(await loadHtml(url), { url, baseUrl: url });
// metadata: { title, author, published, siteName, canonicalUrl, lang, ... }
```

Everything lives in this repository: the library in [`packages/webforai`](packages/webforai), the
CLI in [`packages/cli`](packages/cli) and the hosted platform in [`apps/platform`](apps/platform), which you can
[run yourself](https://github.com/inaridiy/webforai/tree/main/apps/platform#deploying-your-own-instance).
Release notes are in the [CHANGELOG](packages/webforai/CHANGELOG.md).

## Contributing

Issues and pull requests are welcome. `pnpm install`, then `pnpm run test --run` and
`pnpm build`; [AGENTS.md](AGENTS.md) describes the layout of the repository and its conventions.

webforai is developed with Claude Code, and its models are trained on labels made with Codex.

## Support

- [GitHub Sponsors](https://github.com/sponsors/inaridiy)
- [@inaridiy on X](https://x.com/inaridiy)

## License

[Apache 2.0](LICENSE)
