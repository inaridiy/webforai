---
"webforai": patch
---

Cleaner code fences and headings on documentation pages.

- **Code block languages**: SyntaxHighlighter's `brush: js` class (MDN) and Sandpack's `sp-javascript`
  class (react.dev) are read as the block's language. Guessing from the code itself only adopts a
  decisive signal (a shebang, `import … from`, a Dockerfile `FROM`); otherwise the fence has no info
  string instead of a weak guess (JSX labelled `html`, JavaScript labelled `bash`) or `plain`.
- **Language labels**: a language name printed beside a code block (MDN's `js` header) becomes the
  fence's language instead of a stray paragraph above it (`normalize.codeLabels`, default on).
- **Heading permalinks**: a heading wrapped in its own in-page anchor (`## [Title](#title)`, docsify's
  `#/page?id=…`) is written as plain `## Title`. Links to other pages, and in-page links covering only
  part of the heading, are kept (`normalize.headingAnchors`, default on).
- **Extraction**: a "Powered by …" credit in the tail of the page ends the main content, like the
  existing feedback-widget and last-updated terminators.
