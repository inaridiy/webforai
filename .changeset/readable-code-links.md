---
"webforai": minor
---

Markdown that reads as written: code blocks keep their lines when a highlighter wraps each one in a `span.line` without a newline (tailwindcss.com collapsed `npm create …` and `cd …` into one line), relative links and image sources resolve against `url` when no `baseUrl` is given (pass `baseUrl: ""` to keep them as written), and `&` is escaped only where it would start a character reference, so query strings no longer read `?a=1\&b=2`.
