# Web for AI

![LOGO](https://github.com/inaridiy/webforai/blob/main/images/logo.webp)

A library that provides a web interface for AI

## Features

- Ultra-precise HTML2Markdown conversion
- Ultra-precise Markdown segmentation based on AST
- Ultra-precise HTML retrieval functions using headless browsers
- The core functionality is edge-native (runs on Cloudflare Workers!!!)

## Demo

There is a demo API for Html2Markdown deployed on CloudflareWorker. Please access the following link

- [NPM Package page](https://webforai.inaridiy.workers.dev/?url=https://www.npmjs.com/package/webforai)
- [Wikipedia of Cloudflare (AI Mode)](https://webforai.inaridiy.workers.dev/?url=https://en.wikipedia.org/wiki/Cloudflare&mode=ai)

## Quick Start

Just install and execute scripts

```bash
pnpm i webforai playwright
```

```js
import { promises as fs } from "fs";
import { htmlToMarkdown, htmlToMdast } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

const url = "https://www.npmjs.com/package/webforai";
const html = await loadHtml(url);

const markdown = htmlToMarkdown(html, { baseUrl: url });

await fs.writeFile("output.md", markdown);
```

other examples are in [examples](./examples/simple/src/index.ts)

## Examples

- [Simple Example](https://github.com/inaridiy/webforai/tree/main/examples/simple/src/index.ts)
- [Scraping With ChatGPT API](https://github.com/inaridiy/webforai/blob/main/examples/scraping/src/index.ts)
- [Translate Markdown with Splitter](https://github.com/inaridiy/webforai/tree/main/examples/translate)
- [Cloudflare Worker with puppeteer & DO](https://github.com/inaridiy/webforai/tree/main/examples/worker)

## Usage

### Main Functions

**`htmlToMarkdown(html: string, options?: HtmlToMarkdownOptions): string`**  
Convert HTML to Markdown. By default, unnecessary HTML is excluded and processed.
If `solveLinks` is specified, the relative links in the Mdast will be resolved.
This function just calls htmlToMdast and mdastToMarkdown in that order internally.

**`htmlToMdast(html: string, options?: HtmlToMdastOptions): Mdast`**  
This project uses Hast and Mdast as defined by syntax-tree internally.
This function converts HTML to Mdast, an intermediate representation, which is required when using `mdastSplitter`, etc.

**`mdastToMarkdown(mdast: Mdast | RootContent[], options?: { solveLinks?: string }): string`**  
Convert Mdast to Markdown. If `solveLinks` is specified, the relative links in the Mdast will be resolved.

### Loader Functions

**`loadHtml(url: string, options?: LoadHtmlOptions): Promise<string>`**  
Load HTML from the specified URL. This function uses Playwright internally.
