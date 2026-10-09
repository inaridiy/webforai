---
"webforai": minor
"webforai-cli": minor
---

**A `comments` extractor preset, and tables without alignment padding.**

- `commentsExtractor` (preset `comments`, `--extractor comments` in the CLI): the default main
  content, then the page's reader comments under `## Comments` — the `agent` preset without the
  link sections. The comments come from the agent extractor's role models.
- Tables are no longer padded to align their pipes: `| Cell 1 | A much longer cell |` instead of
  every cell padded to its column's widest one. The delimiter row is `| - | - |`. A long cell no
  longer repeats its width as spaces on every row, which made some outputs several times longer
  than their text. Tables parse the same with any GFM parser.
