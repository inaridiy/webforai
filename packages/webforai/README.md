<br/>

<p align="center">
  <a href="https://webforai.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://webforai.dev/images/logo-full-dark.svg">
      <img alt="vocs logo" src="https://webforai.dev/images/logo-full-light.svg" width="auto" height="40">
    </picture>
  </a>
</p>

<p align="center">
  Minimal Documentation Framework, powered by React + Vite.
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
npx webforai@latest
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

## Support

- [GitHub Sponsors](https://github.com/sponsors/inaridiy)
- [inaridiy.eth](https://x.com/inaridiy)

## License

[Apache 2.0](/LICENSE) License
