# ai-learning

Research scaffolding, not a supported tool; the maintained quality gate is `evals/`.

An experiment in tuning extraction with an LLM in the loop. It renders a dataset of articles,
e-commerce, news and technical-documentation pages (`src/datasets.ts`, cached locally after the
first load), converts each with and without extraction, and has Gemini score the extracted
Markdown and list its issues.

- `src/index.ts` — scores the current extractor over the whole dataset and prints the average.
- `src/auto-optimize.ts` — asks the model to propose extractor changes and re-scores them.
- `src/manual.ts` — renders a single page with custom Playwright settings for manual inspection.

## Run

```bash
pnpm install                          # from the repository root (links the workspace webforai)
pnpm --filter webforai build          # the examples import the built package
npx playwright install chromium       # the Playwright loader drives a local Chromium
```

```bash
cd examples/ai-learning
echo "GOOGLE_GENERATIVE_AI_API_KEY=..." > .env
npx tsx src/index.ts                  # or src/auto-optimize.ts / src/manual.ts
```

Writes `output/scores.json`. Expect many model calls (one per page).
