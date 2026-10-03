---
"webforai": minor
---

Cleaner Markdown structure, an extraction report with a page confidence, and a parsing crash fix.

- **Extraction report**: `htmlToMarkdownWithMetadata` returns `extraction: { extractor, confidence }`
  (also via `htmlToMdast(html, { onExtraction })`). `extractor` is `kiwame`, `takumi` (its fallback)
  or `adapter`; for kiwame, `confidence` (0–1) estimates how well the extracted content matches the
  page's main content (about the expected token F1), from a ~2.5 KB model over page statistics. Use
  it to flag pages that probably went wrong.
- **Line breaks**: a paragraph is split where the page leaves a blank line with `<br><br>`, and
  breaks at the start or end of a paragraph or heading no longer leave stray backslashes.
- **Tables**: a table without `<th>` whose first row is entirely bold uses it as the header instead
  of an empty header row; columns empty in every row are dropped; a heading alone in its row (a
  section caption in a pricing table) no longer turns a data table into flattened paragraphs.
- **Inline text**: whitespace at the edges of bold/italic/strikethrough moves outside the markers
  (`**WIN55 **` did not render as bold); Material Icons/Symbols ligature names (`query_builder`) are
  dropped; adjacent `span`/`time`/`label` elements laid out side by side get a space where the
  script changes (`2026-04-10点击次数` → `2026-04-10 点击次数`).
- **Parsing**: requires `hast-util-from-parse5` ^8.0.3, whose hastscript 9 no longer turns elements
  such as `<button type="text">` or `<li type="a" value="3">` into a malformed node that made
  `htmlToMarkdown` throw.

WCEB token F1 is unchanged (0.892); these changes are about structure and robustness.
