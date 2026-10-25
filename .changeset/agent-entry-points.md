---
"webforai": patch
"webforai-cli": patch
---

Docs: the Agent Skill (`webforai skill`) and both READMEs show the no-install way to read a page,
`https://platform.webforai.dev/<url>` (a rate-limited demo without an API key), and the library
README states up front that the quick-start snippet runs as-is in Node.js, Cloudflare Workers and
browsers.

webforai-cli ships its Agent Skill in the package (`dist/skills/webforai/SKILL.md`) as a pi package:
`pi install npm:webforai-cli`.
