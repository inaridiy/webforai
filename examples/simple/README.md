# simple

The smallest end-to-end use of the library: load a page with the Playwright loader and convert
it to Markdown twice — once with main-content extraction (the default) and once without
(`extractors: false`) — so you can compare the two.

## Run

```bash
pnpm install                          # from the repository root (links the workspace webforai)
pnpm --filter webforai build          # the examples import the built package
npx playwright install chromium       # the Playwright loader drives a local Chromium
```

```bash
cd examples/simple
npx tsx src/index.ts --url https://webforai.dev/getting-started
```

Writes `.output/output.html` (the rendered HTML), `.output/output.md` (extracted) and
`.output/output.raw.md` (whole page). `--url` defaults to https://webforai.dev/.

For the same thing without writing code, use the CLI: `npx webforai-cli <url>`.
