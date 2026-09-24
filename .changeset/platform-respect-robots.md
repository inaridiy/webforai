---
"webforai": minor
---

`webforai/platform` and the CLI: new opt-in `respectRobotsTxt` request option (scrape, batch,
crawl) and `--respect-robots` CLI flag (platform loader only). When set, the platform honors the
target site's robots.txt rules for the `webforai-platform` user-agent token; a disallowed URL
fails with `robots_disallowed` and is not billed. Off by default, so existing requests behave
as before.
