# worker

webforai on Cloudflare Workers: a Hono app that renders a URL with
[Browser Rendering](https://developers.cloudflare.com/browser-rendering/) (reusing sessions
through a Durable Object, `BrowserDO`), converts the HTML with webforai inside the Worker, and
returns Markdown. Responses are cached for an hour.

```txt
GET /?url=https://example.com/article             # readability mode (links, tables, images kept)
GET /?url=https://example.com/article&mode=ai     # ai mode (links/tables as text, no images)
```

## Run

```bash
pnpm install                     # from the repository root
pnpm --filter webforai build
cd examples/worker
pnpm dev                         # wrangler dev --remote (Browser Rendering needs a Cloudflare account)
pnpm run deploy                  # wrangler deploy
```

The `browser` binding (`MYBROWSER`) requires a Workers Paid plan. If you would rather not run
browsers yourself, the hosted [webforai platform](https://webforai.dev/platform) does the same
over HTTP — it is itself an open-source Worker in `apps/platform`. See also the
[Cloudflare Workers cookbook](https://webforai.dev/cookbook/cf-workers).
