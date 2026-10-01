---
"webforai": patch
---

Extraction no longer drops inline `code`/`kbd`/`samp`/`var` text that looks like a UI label
(e.g. `<code>--copy</code>`), and a `<dl>` whose rows are wrapped in `<div>`s converts to a
definition list instead of nothing.
