# translate

Page translation with an LLM: renders a blog post with the Playwright loader
(`superBypassMode` for sites that resist headless browsers), converts it to Markdown, and asks
Gemini to translate it into Japanese while cleaning up conversion artifacts.

## Run

```bash
pnpm install                          # from the repository root (links the workspace webforai)
pnpm --filter webforai build          # the examples import the built package
npx playwright install chromium       # the Playwright loader drives a local Chromium
```

```bash
cd examples/translate
echo "GOOGLE_GENERATIVE_AI_API_KEY=..." > .env
npx tsx src/index.ts
```

Prints the translated Markdown to stdout. Change `url` and `targetLanguage` at the top of
`src/index.ts` to try other pages. See also the
[translation cookbook](https://webforai.dev/cookbook/translation).
