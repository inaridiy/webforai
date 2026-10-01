# bench

A quick qualitative benchmark: converts a fixed list of real-world pages (docs, Wikipedia,
news, e-commerce, a search results page) with the heuristic `takumi` extractor (set explicitly;
the library default is the learned kiwame extractor) and the AI-friendly options (`linkAsText`,
`tableAsText`, `hideImage`), saving both the HTML and the Markdown so the output can be
inspected by eye.

## Run

```bash
pnpm install                          # from the repository root (links the workspace webforai)
pnpm --filter webforai build          # the examples import the built package
npx playwright install chromium       # the Playwright loader drives a local Chromium
```

```bash
cd examples/bench
npx tsx src/index.ts
```

Each run writes into `.output/<timestamp>/` — one `.html` and one `.md` per target. The targets
are live sites, so results change over time and some may block automated browsers. For the
repository's regression corpus (scored, reproducible), see `evals/` instead.
