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
  A esm-native library that converts HTML to Markdown & Useful Utilities with simple, lightweight and epic quality.
<p>

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

[Head to the documentation](https://webforai.dev/) to read and learn more about Webforai.

## Overview

```bash
# URL or local HTML file → Markdown on stdout (add -o out.md to write a file)
npx webforai@latest https://example.com/article

# machine-readable output, hosted-platform fetching, agent installation
npx webforai@latest https://example.com --json
npx webforai@latest https://example.com --engine auto      # platform, renders JS when needed
npx webforai@latest skill --install                        # Agent Skill via `npx skills add`
```

or

```ts
import { htmlToMarkdown, htmlToMdast } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

// Load html from url
const url = "https://www.npmjs.com/package/webforai";
const html = await loadHtml(url);

// Convert html to markdown
const markdown = htmlToMarkdown(html, { baseUrl: url });
```

## What v3 changes

**Better extraction.** The main-content extractor scores candidate containers the way Readability
does — paragraph density, link density, class weighting, ancestor propagation — and adds signals
the 2010 heuristics predate: semantic markup (`<article>`, `<main>`, `role="main"`, schema.org
`articleBody`), the rendered geometry a browser loader can supply, and CJK-aware length
thresholds. Across a 60-page corpus of real sites, the share of output lines that were bare links
— the clearest sign navigation leaked in — dropped from 10.6% to 5.0%.

**Site adapters.** Pages that generic scoring cannot read are handled directly, matched by
hostname or by a platform fingerprint so self-hosted instances are covered too: GitHub, Stack
Overflow, npm, MDN, Zenn, Qiita, Medium, Substack, note, Hatena, WordPress, Wikipedia, Reddit,
YouTube, Hacker News, Docusaurus, VitePress, MkDocs, Read the Docs and GitBook. An adapter that
produces too little is ignored in favour of generic extraction, so a site redesign degrades
rather than breaks.

```ts
// Pass adapters: false for generic extraction only.
import { createAutoExtractor } from "webforai";

const markdown = htmlToMarkdown(html, {
  url,
  extractors: [createAutoExtractor({ adapters: false })],
});
```

**Page metadata.**

```ts
import { htmlToMarkdownWithMetadata } from "webforai";

const { markdown, metadata } = htmlToMarkdownWithMetadata(html, { url });
// metadata: { title, author, published, siteName, canonicalUrl, lang, ... }

// Or prepend it as YAML front matter:
const withFrontmatter = htmlToMarkdown(html, { url, frontmatter: true });
```

**Markup fixes.** Lazily-loaded images (`data-src`, `srcset`) now resolve to a real URL instead
of `![alt]()`; KaTeX and MathJax expressions are no longer emitted twice; `role="heading"`
elements become real headings; superscripts and subscripts stay distinguishable; and definition
lists keep their term/definition pairing.

See the [changeset](/.changeset) for the full list, including the breaking changes.

## Platform (hosted API)

[`apps/platform`](https://github.com/inaridiy/webforai/tree/main/apps/platform) is an OSS,
self-hostable SaaS built on this library: a metered crawl→Markdown HTTP API on Cloudflare
(Workers + Workflows + Containers + Browser Run) with Better Auth accounts/API keys and
Stripe usage-based billing. Use it through the typed `webforai/platform` client
(`import { createPlatformClient } from "webforai/platform"`) or the CLI
(`npx webforai <url> --engine auto`); docs live at
[webforai.dev/platform](https://webforai.dev/platform). See its README and the design ledger
in `docs/specs/platform`.

## Support

- [GitHub Sponsors](https://github.com/sponsors/inaridiy)
- [inaridiy.eth](https://x.com/inaridiy)

## License

[Apache 2.0](/LICENSE) License
