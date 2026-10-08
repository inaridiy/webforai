---
"webforai": minor
---

`stripScriptBodies(html)`: empties the script and style bodies conversion never reads, so HTML can be
made smaller before it crosses a process boundary or a size cap; the converted Markdown is unchanged.

- JSON-LD, YouTube's player response and bot-challenge scripts are kept whole.
- Fix: attribute values containing `>` (MediaWiki's `data-mw`) no longer cut the tag short. Pages
  over 2M characters, where the library already strips scripts to bound memory, could lose content
  around such a `<style>` (a Wikipedia list item, for example).
- Linear on hostile input: thousands of unclosed tags or quotes took tens of seconds before; a
  `<script>` inside an HTML comment is left alone.
