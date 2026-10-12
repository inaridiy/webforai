---
"webforai": patch
---

Tables keep their empty cells. Extraction dropped empty `<td>`s, so every later cell of the row
moved one column left (a platform-support table's notes ended up under "host"). Cells of a kept
row are now kept even when empty, and the clean-up no longer removes empty cells; columns empty
in every row are still dropped by the table handler.
