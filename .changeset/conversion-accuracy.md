---
"webforai": minor
---

Conversion accuracy pass. Output changes on many pages; no API changes.

- **Code**: inactive code tabs (npm/yarn/pnpm, `example.ts`/`client.ts`) are kept and labelled as
  fence meta (`title="pnpm"`), including VitePress radio tabs. Furniture and UI-phrase rules no
  longer reach inside `<pre>`/`<code>` (Python's `print` and Go comments were being deleted).
  No blank line after every CodeMirror/Sandpack line, Twoslash hover cards no longer split tokens
  onto separate lines, and shiki-twoslash blocks get their language, drop the "Try" link and show
  errors as `// error TS2345: …`.
- **Tables**: cells holding paragraphs, lists or code are flattened with `<br>`, so rows no longer
  break or leak `&#xA;`; tables of multi-line code samples are laid out as labelled blocks.
- **Extraction**: when the furniture pass would cut too deep, link-dense rails are still removed
  instead of skipping the pass (Amazon carousels, Reddit sidebars); screen-reader-only text in any
  class spelling and consent-manager embed placeholders are removed; `not-sr-only` is no longer
  treated as furniture.
- **Other**: display math inside a sentence becomes its own block; the prepended title drops the
  site name (`Markdown - Wikipedia` → `Markdown`); long `<title>`s are accepted; undescribed
  lazy-loading placeholder images are dropped.
