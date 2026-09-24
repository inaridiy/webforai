---
name: webforai
description: Convert web pages or local HTML files to clean, LLM-ready Markdown with the webforai CLI. Use when a task needs page content as Markdown - reading documentation or articles, scraping, summarising URLs, building text corpora - including JavaScript-heavy or bot-protected pages via the hosted platform.
---

# webforai CLI

Convert a URL or local HTML file to Markdown. Non-interactive by default: the Markdown goes
to stdout, every log goes to stderr, so output can be piped or captured directly.

## Basic usage

```bash
npx webforai https://example.com/article            # Markdown to stdout
npx webforai https://example.com/article -o out.md  # write to a file instead
npx webforai ./page.html                            # convert a local HTML file
npx webforai https://example.com --json             # machine-readable envelope (see below)
```

## Flags

- `-o, --output <path>` — write Markdown to a file instead of stdout.
- `-l, --loader <fetch|playwright|platform>` — how HTML is acquired. Default: `fetch` for
  URLs, automatic `local` for file paths. `playwright` renders JavaScript locally (needs
  `npx playwright install chromium`). `platform` uses the hosted API (below).
- `-m, --mode <default|ai>` — `ai` strips links/tables/images down to plain text
  (local conversion only).
- `--extractor <auto|takumi|minimal|none>` — main-content extraction preset
  (`none` converts the whole page).
- `--frontmatter` — prepend YAML front matter (title, author, canonical URL, ...).
- `--json` — print a JSON envelope to stdout instead of raw Markdown.
- `--engine <auto|fetch|browser|proxy-fetch|proxy-browser>` — platform acquisition engine
  (implies `-l platform`). `auto` (the platform default) starts with a plain fetch and
  escalates to browser rendering when the page is a client-rendered shell;
  `browser`/`proxy-browser` always render JavaScript; `proxy-*` engines egress through
  rotating proxies for bot-protected sites.
- `--region <auto|jp>` — platform proxy egress region (implies `-l platform`).
- `--screenshot` — platform browser engines only; the envelope carries an expiring
  `screenshotUrl`.
- `--api-key <key>` / `--platform-url <url>` — platform credentials and host; usually set
  via env vars instead.
- `-i, --interactive` — guided prompt flow (for humans; do not use from an agent).
- `-d, --debug` — verbose logs on stderr.

## JSON envelope (`--json`)

```json
{
  "source": "https://example.com",
  "loader": "fetch",
  "url": "https://example.com",
  "markdown": "# ...",
  "metadata": { "title": "..." },
  "engine": "browser",
  "region": "auto",
  "credits": 5,
  "screenshotUrl": "https://...",
  "output": "out.md"
}
```

`engine`/`region`/`credits`/`screenshotUrl` appear only for the platform loader; `output`
only when `-o` also wrote a file. A `warning` field appears when the result is probably
degraded — most commonly a client-rendered shell fetched without JavaScript; rerun with
`--engine auto` (or `-l playwright`) when you see one.

## Hosted platform

For JavaScript-heavy or bot-protected pages, the hosted platform fetches server-side:

```bash
export WEBFORAI_API_KEY=wfa_...       # from https://platform.webforai.dev/dashboard
npx webforai https://example.com --engine auto --json
```

`WEBFORAI_PLATFORM_URL` overrides the host for self-hosted deployments. Requests are metered
in credits (fetch 1, browser 2, proxy-fetch 2, proxy-browser 3; `auto` bills the engine that
actually ran); failures are never billed.

## Exit codes

- `0` — success.
- `1` — runtime failure (network, conversion, platform error; message on stderr).
- `2` — usage error (unknown flag or invalid value; message on stderr).

## Errors worth handling

- `payment_required` on stderr → platform credits exhausted.
- `rate_limited` → back off (a `retryAfter` seconds hint is included when known).
- Playwright loader errors explain the exact `npx playwright install` command to run.
