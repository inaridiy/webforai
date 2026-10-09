---
"webforai": patch
---

Two extraction fixes found by comparing webforai with [Defuddle](https://github.com/kepano/defuddle)
(MIT; the adapted rules are credited in the source and in `THIRD_PARTY_NOTICES.md`, now shipped in
the package).

- **Small specification tables**: a table of ten cells or fewer whose cells are all short
  ("Model No. | HT02G", "Flight Time | 21 mins") is converted to a GFM table instead of being
  flattened into loose lines as page layout. Small grids holding prose, single rows and
  single columns are still treated as layout.
- **Screen-reader duplicates**: when an `aria-hidden="true"` element repeats a visible sibling's
  text exactly (Amazon's truncation widget), the text is written once instead of twice. Other
  `aria-hidden` content is kept.
