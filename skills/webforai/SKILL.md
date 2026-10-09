---
name: webforai
description: Convert web pages or local HTML files to clean, LLM-ready Markdown with the webforai CLI. Use when a task needs page content as Markdown - reading documentation or articles, scraping, summarising URLs, crawling a docs site into files or llms.txt, building text corpora - including JavaScript-heavy or bot-protected pages via the hosted platform.
---

# webforai CLI

Convert a URL or local HTML file to Markdown. Non-interactive by default: the Markdown goes
to stdout, every log goes to stderr, so output can be piped or captured directly.

## Basic usage

```bash
npx @webforai/cli https://example.com/article            # Markdown to stdout
npx @webforai/cli https://example.com/article -o out.md  # write to a file instead
npx @webforai/cli ./page.html                            # convert a local HTML file
npx @webforai/cli https://example.com --json             # machine-readable envelope (see below)
```

## Which command

- One page, or a handful you will read right away → `npx @webforai/cli <url>` (free, local;
  add `--engine auto` when the page needs JavaScript or blocks plain fetches).
- A known list of URLs (2–100) to keep as files → `npx @webforai/cli batch` (hosted platform).
- A whole site or docs section → `npx @webforai/cli crawl` (hosted platform); add `--llms-txt`
  for a single `llms-full.txt` you can read in one go.

## Flags

- `-o, --output <path>` — write Markdown to a file instead of stdout.
- `-l, --loader <fetch|playwright|platform>` — how HTML is acquired. Default: `fetch` for
  URLs, automatic `local` for file paths. `playwright` renders JavaScript locally (needs
  `npx playwright install chromium`). `platform` uses the hosted API (below).
- `-m, --mode <default|ai>` — `ai` strips links/tables/images down to plain text
  (local conversion only).
- `--extractor <auto|readability|agent|kiwame|takumi|minimal|none>` — main-content extraction preset (`agent`: main content plus role-grouped links)
  (`kiwame` is the learned block classifier, `takumi` the heuristic; `none` converts the whole page).
- `--frontmatter` — prepend YAML front matter (title, author, canonical URL, ...).
- `--json` — print a JSON envelope to stdout instead of raw Markdown.
- `--engine <auto|fetch|browser|proxy-fetch|proxy-browser>` — platform acquisition engine
  (implies `-l platform`). `auto` (the platform default) starts with a plain fetch and
  escalates to browser rendering when the page is a client-rendered shell;
  `browser`/`proxy-browser` always render JavaScript; `proxy-*` engines egress through
  rotating proxies for bot-protected sites (paid plan only).
- `--region <auto|jp>` — platform proxy egress region (implies `-l platform`); `jp` runs
  on the proxy tier, so it needs a paid plan too.
- `--screenshot` — platform browser engines only; the envelope carries an expiring
  `screenshotUrl`.
- `--respect-robots` — platform loader only; honor the target site's robots.txt rules
  (off by default). A disallowed URL fails with `robots_disallowed` and is not billed.
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
npx @webforai/cli https://example.com --engine auto --json
```

`WEBFORAI_PLATFORM_URL` overrides the host for self-hosted deployments. Accounts get 1,000
free credits per month; failures are never billed.

| operation | credits |
| --- | --- |
| `fetch` | 1 |
| `browser` | 2 |
| `proxy-fetch` (paid plan only) | 2 |
| `proxy-browser` (paid plan only) | 3 |
| `--screenshot` | +1 |
| image rehosting (API `rehostImages`) | +1 per started 5 images |

`auto` bills the engine that actually ran (1, or 2 when it needed a browser). The proxy
engines — and `--region jp`, which runs on them — need an active subscription; on the free
allowance they fail with `payment_required`. Prefer `--engine auto` unless a site blocks
it. Batch and crawl jobs bill per converted page.

## Crawl and batch (hosted platform)

```bash
# a docs site → one .md per page, mirroring URL paths, plus llms.txt / llms-full.txt
npx @webforai/cli crawl https://docs.example.com -o docs --limit 100 --include '^/docs' --llms-txt

# a list of URLs (arguments, or one per line via --file; '-' reads stdin)
npx @webforai/cli batch https://a.example/post https://b.example/news -o pages
npx @webforai/cli batch --file urls.txt -o pages --json
```

Both submit an async job, wait for it, then write every converted page under `-o <dir>`
(`/docs/intro` → `docs/intro.md`; batch prefixes the host: `a.example/post.md`). stdout
lists the written files, one per line; `--json` prints `{ jobId, status, credits, pages:
[{ url, file, title }], failures: [{ url, code, message }], llmsTxt?, llmsFullTxt? }`
instead. Progress and the summary go to stderr. Exit code 1 when the job failed or no page
converted; individual failed pages are listed but do not fail the command.

- `crawl <url>` — same-origin only. `--max-depth <0-5>` (default 2), `--limit <1-500>`
  (default 50), `--include <regex>` / `--exclude <regex>` on the pathname (repeatable).
  `--sitemap <skip|include|only>`: `include` adds the site's sitemap URLs to the links it
  follows, `only` crawls just the seed plus sitemap URLs (best for blogs and large docs with
  a good sitemap). Honors robots.txt by default; `--no-respect-robots` turns that off.
- `--llms-txt` (crawl) — also write `llms.txt` (site title, summary, `- [title](url):
  description` links grouped by top-level path) and `llms-full.txt` (every page's Markdown
  concatenated) per llmstxt.org. Read `llms-full.txt` when you need the whole site in context.
- `batch [urls...]` — up to 100 URLs per job; `-f, --file <path|->` adds URLs from a file.
  `--respect-robots` opts in to robots.txt checks.
- Shared: `--engine`, `--region`, `--extractor`, `--frontmatter`, `--json`,
  `--timeout <seconds>` (default 1800; the job keeps running after a timeout and results stay
  available for 7 days), `--api-key`, `--platform-url`, `-d`.

## Exit codes

- `0` — success.
- `1` — runtime failure (network, conversion, platform error; message on stderr).
- `2` — usage error (unknown flag or invalid value; message on stderr).

## Errors worth handling

Platform errors print as `error: <code>: <message>` on stderr (exit 1). What to do:

- `invalid_api_key` (401) → the key is missing, revoked or mistyped. Do not retry; ask the
  user for a key from the dashboard named in the message.
- `payment_required` (402) → the free monthly allowance is used up, or a proxy engine /
  `--region jp` was requested without a subscription. Do not retry; fall back to
  `--engine auto` (or the local loaders) for proxy requests, otherwise tell the user.
- `spend_cap_reached` (402) → the account's monthly spend cap (default $50) is reached; the
  user can raise it on the dashboard. Do not retry.
- `rate_limited` (429) → per-account limit: 60 requests/minute (free), 600 (paid). Wait the
  `retryAfter` seconds shown, then retry; for many URLs use one `batch` job instead of a
  loop of single requests. `crawl`/`batch` retry this automatically.
- `too_many_jobs` (429) → 3 (free) / 20 (paid) batch/crawl jobs already queued or running.
  Wait for one to finish, then resubmit.
- `robots_disallowed` (403) → robots.txt disallows the URL (`--respect-robots`, or a crawl
  by default). Not billed; respect it unless the user explicitly decides otherwise.
- `invalid_request` (400) → a bad flag value or URL; fix the input.
- `engine_unavailable` / `scheduling_unknown` / `result_unavailable` (503) → transient;
  retry later.
- Playwright loader errors explain the exact `npx playwright install` command to run.
