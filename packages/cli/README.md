# webforai-cli

The webforai command line: convert a URL or a local HTML file to clean, LLM-ready Markdown.
The Markdown goes to stdout and every log to stderr, so it composes with pipes, scripts and
AI agents. Conversion is done by the [`webforai`](https://www.npmjs.com/package/webforai)
library; this package adds the command.

```bash
npx webforai-cli https://example.com/article             # Markdown to stdout
npx webforai-cli https://example.com/article -o out.md   # write a file
npx webforai-cli ./page.html                             # convert a local HTML file
npx webforai-cli https://example.com --json              # machine-readable envelope
```

Install it once to keep a `webforai` command on your `PATH`:

```bash
npm i -g webforai-cli
webforai https://example.com/article
```

Up to v4 the CLI shipped inside the `webforai` package (`npx webforai`). Since v5 that package
is the library only, and `npx webforai` prints the `webforai-cli` command to run instead.
Flags, output and exit codes are unchanged.

## Hosted platform

`--engine`, `crawl` and `batch` use the [webforai platform](https://webforai.dev/platform),
which renders JavaScript, goes through proxies and crawls whole sites. They need an API key
from [platform.webforai.dev](https://platform.webforai.dev):

```bash
export WEBFORAI_API_KEY=wfa_...
npx webforai-cli https://example.com --engine auto                   # renders JavaScript when needed
npx webforai-cli crawl https://docs.example.com -o docs --llms-txt   # site → .md files + llms.txt
npx webforai-cli batch --file urls.txt -o pages                      # many URLs → one .md per page
```

## For AI agents

`npx webforai-cli skill --install` installs an [Agent Skill](https://github.com/vercel-labs/skills)
that teaches Claude Code, Cursor and other coding agents when and how to call the CLI.

## Documentation

Every flag, the JSON envelope, exit codes and the Playwright loader:
[webforai.dev/cli](https://webforai.dev/cli).

## License

[Apache 2.0](https://github.com/inaridiy/webforai/blob/main/LICENSE)
