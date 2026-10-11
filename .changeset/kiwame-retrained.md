---
"webforai": minor
---

**kiwame, its page-confidence model and agent mode's role models are retrained on labels made
with Codex.**

- Extraction is as accurate as before: WCEB F1 0.891 with the default preset (was 0.892) and
  0.923 with `comments` (was 0.922); the corpus checks, code blocks and tables are unchanged.
- `extraction.confidence` comes from the retrained confidence model, so its values shift a little.
- kiwame also ends the content at page-end wording its models dropped ("Powered by …", "Was this
  page helpful?"), so the blocks after a site-generator credit no longer stay.
