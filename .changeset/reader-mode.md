---
"webforai": major
"webforai-cli": major
---

**The default extraction is called reader mode: the `readability` preset is now `reader`.**

Use `presetExtractors("reader")` or `readerExtractor` in the library, `--extractor reader` in the
CLI and `convert: { extractor: "reader" }` on the hosted platform. The `readability` preset and
`readabilityExtractor` are removed. The default — `auto`, or no option — is unchanged.
