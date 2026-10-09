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
  Convert web pages and local HTML to clean, LLM-ready Markdown — with a TypeScript library, a CLI (<code>npx webforai-cli</code>), or a hosted API.
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

## Documentation

Everything is documented at **[webforai.dev](https://webforai.dev)**. Start from what you want to do:

| I want to… | Use | Start here |
| --- | --- | --- |
| convert HTML in my own code (Node.js, browsers, Workers) | the `webforai` library | [Getting started](https://webforai.dev/getting-started) |
| embed webforai in my own library or tool | the `webforai` library | [Embedding in your project](https://webforai.dev/embedding) |
| get Markdown for a URL from the shell or an AI agent | the CLI, `npx webforai-cli <url>` | [CLI](https://webforai.dev/cli) |
| call a hosted API that runs the browsers and proxies for me | webforai platform | [platform.webforai.dev](https://platform.webforai.dev) (sign-up, API keys, usage) · [platform docs](https://webforai.dev/platform) |
| run my own copy of that platform | [`apps/platform`](https://github.com/inaridiy/webforai/tree/main/apps/platform) | [Deploying your own instance](https://github.com/inaridiy/webforai/tree/main/apps/platform#deploying-your-own-instance) |

## Packages

| npm package | source | what it is |
| --- | --- | --- |
| [`webforai`](https://www.npmjs.com/package/webforai) | [`packages/webforai`](packages/webforai) | The library: `htmlToMarkdown`, extractors, site adapters, loaders (`webforai/loaders/*`) and the typed platform client (`webforai/platform`). No CLI or browser dependencies. |
| [`webforai-cli`](https://www.npmjs.com/package/webforai-cli) | [`packages/cli`](packages/cli) | The `webforai` command, built on the library. |

Up to v4 the CLI shipped inside `webforai` (`npx webforai`); since v5 it is `webforai-cli`.

## Quick start

### CLI

```bash
# URL or local HTML file → Markdown on stdout (add -o out.md to write a file)
npx webforai-cli@latest https://example.com/article

# machine-readable output
npx webforai-cli@latest https://example.com --json
```

These commands use the [hosted platform](#platform-hosted-api) and need an API key:

```bash
npx webforai-cli@latest https://example.com --engine auto      # renders JavaScript when needed
npx webforai-cli@latest crawl https://docs.example.com -o docs --llms-txt   # site → .md files + llms.txt
npx webforai-cli@latest batch --file urls.txt -o pages         # many URLs → one .md per page
```

To let an AI agent (Claude Code, Cursor, …) call the CLI, install it as an Agent Skill with
`npx webforai-cli@latest skill --install`. Flags, exit codes and error output are covered in the
[CLI docs](https://webforai.dev/cli).

### Library

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

For pages that need JavaScript to render, load them with the Playwright loader
(`import { loadHtml } from "webforai/loaders/playwright"`). `playwright-core` is an optional
peer dependency, so add it yourself (`npm i playwright-core`) and download a browser once
(`npx playwright-core install chromium`); see [Loaders](https://webforai.dev/docs/loaders).

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

  const { markdown, metadata } = htmlToMarkdownWithMetadata(html, { url });
  // metadata: { title, author, published, siteName, canonicalUrl, lang, ... }

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
[billing](https://webforai.dev/platform/billing). The service is open source and self-hostable
(see the table above).

## Contributing

See [AGENTS.md](AGENTS.md) for the toolchain (`pnpm install`, `pnpm test --run`, `pnpm build`)
and where things live.

## Support

- [GitHub Sponsors](https://github.com/sponsors/inaridiy)
- [@inaridiy on X](https://x.com/inaridiy)

## License

[Apache 2.0](https://github.com/inaridiy/webforai/blob/main/LICENSE)
