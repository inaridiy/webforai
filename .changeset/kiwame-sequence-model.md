---
"webforai": minor
---

kiwame, the default extractor for pages without a site adapter, selects main content more
accurately.

- **Sequence model**: a small bidirectional GRU reads the page's blocks in order — their features,
  hashed words and character pairs, and the tag and class names around them — and its estimate is
  averaged with the gradient-boosted trees'. Weights are int8 (about 100 KB); it adds a few
  milliseconds on a typical page.
- **Page title**: blocks are scored by where they sit relative to the block that repeats the page's
  title (`og:title` or `<title>`), so a product page's own details are told apart from the other
  products listed beside them, and an article from its related-posts rail.
- **Within-page scores**: the second stage sees where each block's score sits within its page
  (rank, ratio to the page's best block), not only its absolute value.
- **Clean-up**: a link-only block the models chose to keep (a grid of product cards, a list of
  results) is no longer removed by the final clean-up; a tail-positioned "Related articles" rail or
  feedback widget still ends the content.
- The models were retrained; the default threshold is now 0.5 and the confidence model was
  refitted.
- `createKiwameExtractor` accepts `neuralModel` (`null` turns the sequence model off),
  `neuralWeight`, `cleanupSpare`, and evaluation hooks `probabilities` and `postRules`.

WCEB token F1 is 0.892 per page (unchanged) and 0.909 over its eight datasets (was 0.903).
