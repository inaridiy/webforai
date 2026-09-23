# site — webforai.dev

The documentation site for everything in this repository, built with [Vocs](https://vocs.dev)
and served by a Cloudflare Worker (`workers/index.tsx` adds the `/api/ogp` image route; the
static build is bound as `ASSETS`).

It is the **only** documentation source: the library (`packages/webforai`), the CLI
(`npx webforai`), the `webforai/platform` client and the hosted platform API are all
documented here. The platform app (platform.webforai.dev) has no docs of its own and links
back to `/platform`.

| path | content |
| --- | --- |
| `/`, `/getting-started`, `/installation`, `/how-it-works`, `/docs/*`, `/cookbook/*` | library |
| `/cli` | CLI and Agent Skill |
| `/platform`, `/platform/api-reference`, `/platform/client`, `/platform/billing` | hosted platform API |

The header's "Platform" dropdown separates the product (external links to
platform.webforai.dev) from the platform docs; keep that split when adding entries. The
platform host used by components (the landing's live demo and "ways to use" cards) is
`PLATFORM_ORIGIN` in `docs/components/platform.ts`.

## Commands

```bash
pnpm --filter site dev            # vocs dev server
pnpm --filter site build          # static build into docs/dist
pnpm --filter site worker:dev     # serve the build through the Worker (wrangler dev)
pnpm --filter site worker:deploy  # deploy webforai.dev (run build first)
```
