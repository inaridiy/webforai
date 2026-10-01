---
"webforai": patch
---

Code blocks take their language from `data-language` / `data-lang` (Shiki via
rehype-pretty-code, as on shadcn-style docs) instead of falling back to detection or `plain`.
