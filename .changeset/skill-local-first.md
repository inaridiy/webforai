---
"webforai-cli": patch
---

For client-rendered pages the client-shell warning and the Agent Skill now suggest the local
`--loader playwright` first and `--engine auto` (hosted platform) only when `WEBFORAI_API_KEY` is
set, so an agent without a key no longer fails with `invalid_api_key` before trying the free path.
