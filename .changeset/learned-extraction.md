---
"webforai": minor
---

Learned main-content extraction, and Worker-safe parsing.

- **New default for pages without a site adapter**: `learnedExtractor`, a two-stage gradient-boosted
  tree classifier over text blocks (~100 KB of generated TypeScript, no WASM or new dependencies).
  Token F1 on the WCEB benchmark 0.874 → 0.892. `takumiExtractor` stays available, `createAutoExtractor({ fallback })`
  selects the extractor behind the site adapters, and the CLI gains `--extractor learned`
  (local conversion only; `takumi` keeps the heuristic).
- **Parsing for Workers**: HTML is parsed without source positions (about half the tree memory)
  and with element nesting capped at 256 levels; 2,000 nested elements used to throw
  `RangeError`. Documents over 2 M characters have script and style bodies emptied before
  parsing (JSON-LD kept).
- New exports: `learnedExtractor`, `createLearnedExtractor`, `LearnedExtractorOptions`.
