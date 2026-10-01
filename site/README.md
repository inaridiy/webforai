# site — webforai.dev

The documentation site for everything in this repository, built with [Vocs](https://vocs.dev)
and served by a Cloudflare Worker (`workers/index.tsx` adds the `/api/ogp` image route; the
static build is bound as `ASSETS`).

Run locally: `pnpm --filter site dev` (no library build needed; `build` does need one).

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
pnpm --filter site build          # static build into docs/dist (needs `pnpm --filter webforai build` first)
pnpm --filter site worker:dev     # serve the build through the Worker (wrangler dev)
pnpm --filter site worker:deploy  # deploy webforai.dev (run build first)
```

## Build outputs for agents and crawlers

`pnpm --filter site build` runs `vocs build`, then `scripts/postbuild.mjs`, which converts every
prerendered page **with webforai itself** and writes, next to the HTML in `docs/dist`:

- `/<path>.md` — each page as Markdown (`/cli.md`, `/platform/api-reference.md`, `/index.md`),
  linked from the page head as `rel="alternate" type="text/markdown"`;
- `/llms.txt` (an [llmstxt.org](https://llmstxt.org) index of those files) and `/llms-full.txt`
  (all of them concatenated);
- `/sitemap.xml`, `/robots.txt` (with its `Sitemap:` line) and `/404.html`, which the Worker
  serves with status 404 for unknown paths.

It also gives each page a canonical link and its own `og:url`, and URL-encodes the OG image
query. The build fails when a page converts to (near-)empty Markdown, so extraction regressions
cannot ship silently.
