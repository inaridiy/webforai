---
"webforai": minor
---

CLI: `webforai crawl <url> -o <dir>` and `webforai batch [urls…|-f file] -o <dir>` run platform
jobs and write one Markdown file per page (`--llms-txt` also writes `llms.txt` and
`llms-full.txt`; `--sitemap skip|include|only` seeds a crawl from the site's sitemaps).
`webforai/platform` exposes the crawl `sitemap` option, and 401/402 errors name the dashboard
where a key or a plan is managed.
