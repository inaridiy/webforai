# Web for AI

[![LOGO](https://github.com/inaridiy/webforai/raw/main/images/logo.webp)](https://github.com/inaridiy/webforai/blob/main/images/logo.webp)

A library that provides a web interface for AI

## Features

- Ultra-precise HTML2Markdown conversion
- Ultra-precise Markdown segmentation based on AST
- Ultra-precise HTML retrieval functions using headless browsers
- The core functionality is edge-native (runs on Cloudflare Workers!!!)
- Command-line interface for easy use without coding

## Demo

There is a demo API for Html2Markdown deployed on CloudflareWorker. Please access the following link

- [NPM Package page](https://webforai.inaridiy.workers.dev/?url=https://www.npmjs.com/package/webforai)
- [Wikipedia of Cloudflare (AI Mode)](https://webforai.inaridiy.workers.dev/?url=https://en.wikipedia.org/wiki/Cloudflare\&mode=ai)

## Installation

### As a library

To use WebforAI as a library in your project, install it along with playwright:

```shell
pnpm i webforai playwright
```

### As a CLI tool

To use WebforAI as a command-line tool, install it globally:

```shell
npm install -g webforai
```

## Quick Start

### Using as a library

Just install and execute scripts

```js
import { promises as fs } from "fs";
import { htmlToMarkdown, htmlToMdast } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

const url = "https://www.npmjs.com/package/webforai";
const html = await loadHtml(url);

const markdown = htmlToMarkdown(html, { baseUrl: url });

await fs.writeFile("output.md", markdown);
```

other examples are in [examples](https://github.com/inaridiy/webforai/blob/HEAD/examples/simple/src/index.ts)

### Using as a CLI tool

After installing globally, you can use the webforai command:

```shell
webforai https://www.npmjs.com/package/webforai output.md
```

This will fetch the HTML from the specified URL, convert it to Markdown, and save it to output.md.

For more CLI options, run:

```shell
webforai --help
```

## Examples

- [Simple Example](https://github.com/inaridiy/webforai/tree/main/examples/simple/src/index.ts)
- [Scraping With ChatGPT API](https://github.com/inaridiy/webforai/blob/main/examples/scraping/src/index.ts)
- [Translate Markdown with Splitter](https://github.com/inaridiy/webforai/tree/main/examples/translate)
- [Cloudflare Worker with puppeteer & DO](https://github.com/inaridiy/webforai/tree/main/examples/worker)

## Usage

### Main Functions

**`htmlToMarkdown(html: string, options?: HtmlToMarkdownOptions): string`**\
Convert HTML to Markdown. By default, unnecessary HTML is excluded and processed. If `solveLinks` is specified, the relative links in the Mdast will be resolved. This function just calls htmlToMdast and mdastToMarkdown in that order internally.

**`htmlToMdast(html: string, options?: HtmlToMdastOptions): Mdast`**\
This project uses Hast and Mdast as defined by syntax-tree internally. This function converts HTML to Mdast, an intermediate representation, which is required when using `mdastSplitter`, etc.

**`mdastToMarkdown(mdast: Mdast | RootContent[], options?: { solveLinks?: string }): string`**\
Convert Mdast to Markdown. If `solveLinks` is specified, the relative links in the Mdast will be resolved.

### Loader Functions

**`loadHtml(url: string, options?: LoadHtmlOptions): Promise<string>`**\
Load HTML from the specified URL. This function uses Playwright internally.

### CLI Commands

**`webforai <source?> <outputPath?> [options]`** Converts the HTML at the specified URL or path to Markdown and saves it to an output file. Arguments and options can be specified in the interactive interface even if they are not specified.

- **`source`**\
  The URL or path to the HTML file to convert.
- **`outputPath`** The path to save the output Markdown file.

#### Options

- **`--mode <mode>`**\
  Specify the mode to use for conversion. Options are `default` and `ai`. Default is `default`.
- **`--loader <loader>`**\
  Specify the loader to use for fetching HTML. Options are `fetch`, `playwright` and `puppeteer`. Default is `fetch`.
- **`--baseUrl <baseUrl>`** Specify the base URL to use for relative links in the output Markdown.
- **`-o --stdout`**\
  Output the converted Markdown to the console instead of saving it to a file.
- **`-d --debug`**\
  Enable debug mode. This will output additional information to the console.

**`webforai --help`** Displays help information for the CLI tool.

## Contributing

1. Fork it!
2. Create your feature branch: `git checkout -b my-new-feature`
3. Add your changes: `git add .`
4. Commit your changes: `git commit -am 'Add some feature'`
5. Add a changelog: `pnpm changeset`
6. Push to the branch: `git push origin my-new-feature`
7. Submit a pull request 😎
