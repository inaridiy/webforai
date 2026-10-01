# scraping

Structured extraction with an LLM: renders three package pages (npm, crates.io, GitHub),
converts each to Markdown with webforai, and asks OpenAI to return `name`, `description`,
`language` and `license` as JSON.

## Run

```bash
pnpm install                          # from the repository root (links the workspace webforai)
pnpm --filter webforai build          # the examples import the built package
npx playwright install chromium       # the Playwright loader drives a local Chromium
```

```bash
cd examples/scraping
echo "OPENAI_API_KEY=sk-..." > .env
npx tsx src/index.ts
```

Writes `.output/scraped-packages.json`. The point of the example is the input side: clean
Markdown is a much smaller, less noisy prompt than raw HTML. See also the
[structured output cookbook](https://webforai.dev/cookbook/structured-output).
