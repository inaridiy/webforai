---
"webforai": minor
---

`webforai/platform` and the CLI: `region` is now `auto` | `jp` — the hosted platform only has
dedicated Japanese egress IPs. `us`, `eu`, `uk` and `asia` were never honoured reliably and are
rejected by the API (`400 invalid_request`) and by `--region` (usage error `2`).
