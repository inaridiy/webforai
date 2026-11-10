---
"webforai": minor
---

Content that a React server streams after the page's shell (Next.js App Router, GitBook) is put back where the browser would put it. Fetched without JavaScript, these pages carry the late parts as hidden `<div id="S:…">` segments at the end of the document, and extraction dropped them: every code block of a GitBook page, for one.
