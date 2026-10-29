# webforai-cli

## 5.0.2

### Patch Changes

- Updated dependencies [[`e471730`](https://github.com/inaridiy/webforai/commit/e4717304a33bfcbbc1dcb69f792d4982b7ad9832)]:
  - webforai@5.0.2

## 5.0.1

### Patch Changes

- [#90](https://github.com/inaridiy/webforai/pull/90) [`10d6e70`](https://github.com/inaridiy/webforai/commit/10d6e701a9b842c2002ce5ce7cd92b012d7ee404) Thanks [@inaridiy](https://github.com/inaridiy)! - Docs: the Agent Skill (`webforai skill`) and both READMEs show the no-install way to read a page,
  `https://platform.webforai.dev/<url>` (a rate-limited demo without an API key), and the library
  README states up front that the quick-start snippet runs as-is in Node.js, Cloudflare Workers and
  browsers.

  webforai-cli ships its Agent Skill in the package (`dist/skills/webforai/SKILL.md`) as a pi package:
  `pi install npm:webforai-cli`.

- [#92](https://github.com/inaridiy/webforai/pull/92) [`503511a`](https://github.com/inaridiy/webforai/commit/503511ac99cba2adf37045866f3f8c996d1b7611) Thanks [@inaridiy](https://github.com/inaridiy)! - For client-rendered pages the client-shell warning and the Agent Skill now suggest the local
  `--loader playwright` first and `--engine auto` (hosted platform) only when `WEBFORAI_API_KEY` is
  set, so an agent without a key no longer fails with `invalid_api_key` before trying the free path.
- Updated dependencies [[`10d6e70`](https://github.com/inaridiy/webforai/commit/10d6e701a9b842c2002ce5ce7cd92b012d7ee404)]:
  - webforai@5.0.1

## 5.0.0

### Major Changes

- [#87](https://github.com/inaridiy/webforai/pull/87) [`ab93e23`](https://github.com/inaridiy/webforai/commit/ab93e2368a67b42095f834664d9ffccff90930bb) Thanks [@inaridiy](https://github.com/inaridiy)! - **The default extraction is called reader mode: the `readability` preset is now `reader`.**

  Use `presetExtractors("reader")` or `readerExtractor` in the library, `--extractor reader` in the
  CLI and `convert: { extractor: "reader" }` on the hosted platform. The `readability` preset and
  `readabilityExtractor` are removed. The default — `auto`, or no option — is unchanged.

- [#87](https://github.com/inaridiy/webforai/pull/87) [`ab93e23`](https://github.com/inaridiy/webforai/commit/ab93e2368a67b42095f834664d9ffccff90930bb) Thanks [@inaridiy](https://github.com/inaridiy)! - **The CLI moved to its own package, `webforai-cli`; `webforai` is now the library only.**

  `webforai` no longer installs the CLI's dependencies (`commander`, `@clack/prompts`, `boxen`,
  `picocolors`), and every loader peer — including `playwright-core`, which npm 7+ and pnpm used to
  install automatically — is now optional. Installing the library for `htmlToMarkdown` no longer
  pulls in a 14 MB browser driver.

  Migrating:

  - **CLI:** run `npx webforai-cli <url>` (or `npm i -g webforai-cli`; the command is still
    `webforai`, so run `npm uninstall -g webforai` first if v4 is installed globally). Flags and
    exit codes are unchanged. `npx webforai` now only prints this migration hint and exits with
    code 1.
  - **Agent Skill:** reinstall it with `npx webforai-cli skill --install` so it calls the new package.
  - **Library:** no code changes. If you import `webforai/loaders/playwright`, add `playwright-core`
    to your own dependencies (`npm i playwright-core`); the Puppeteer loaders already needed this.

### Minor Changes

- [#87](https://github.com/inaridiy/webforai/pull/87) [`ab93e23`](https://github.com/inaridiy/webforai/commit/ab93e2368a67b42095f834664d9ffccff90930bb) Thanks [@inaridiy](https://github.com/inaridiy)! - **A `comments` extractor preset, and tables without alignment padding.**

  - `commentsExtractor` (preset `comments`, `--extractor comments` in the CLI): the default main
    content, then the page's reader comments under `## Comments` — the `agent` preset without the
    link sections. The comments come from the agent extractor's role models.
  - Tables are no longer padded to align their pipes: `| Cell 1 | A much longer cell |` instead of
    every cell padded to its column's widest one. The delimiter row is `| - | - |`. A long cell no
    longer repeats its width as spaces on every row, which made some outputs several times longer
    than their text. Tables parse the same with any GFM parser.

### Patch Changes

- Updated dependencies [[`ab93e23`](https://github.com/inaridiy/webforai/commit/ab93e2368a67b42095f834664d9ffccff90930bb), [`ab93e23`](https://github.com/inaridiy/webforai/commit/ab93e2368a67b42095f834664d9ffccff90930bb), [`ab93e23`](https://github.com/inaridiy/webforai/commit/ab93e2368a67b42095f834664d9ffccff90930bb), [`ab93e23`](https://github.com/inaridiy/webforai/commit/ab93e2368a67b42095f834664d9ffccff90930bb), [`ab93e23`](https://github.com/inaridiy/webforai/commit/ab93e2368a67b42095f834664d9ffccff90930bb)]:
  - webforai@5.0.0
