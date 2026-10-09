---
"webforai": patch
---

Hacker News: top-level comments keep their text. The adapter returned only the author line for
an unindented comment, so every top-level comment's body was missing (10 of 68 comments on the
corpus thread); replies were unaffected.
