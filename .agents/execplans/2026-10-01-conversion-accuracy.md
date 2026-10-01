# Conversion accuracy pass

Improve `packages/webforai` output accuracy without giving up stability, throughput or memory.
Ideas were sparred with two independent agents (extraction; conversion fidelity), each grounded
in the cached corpus; every change below is measured against the frozen HEAD (5fe6dc3) outputs.

## Baseline (5fe6dc3, `bench:compare`, 60 captures)

checks 74/74 · code fence recall 702/748 · table recall 27/64 · nav-leak captures 7 ·
boilerplate-marker captures 3 · empty outputs 1 · webforai corpus time ≈ 3.1–3.4 s.

`nhk-news/rendered` (login-gated capture) and `reddit-thread/static` (logo-only shell) are
correct short outputs, not extraction losses.

## Progress

- [x] (2026-10-01) Extraction: tiered furniture pass, screen-reader-only classes in any naming
      convention, consent-manager embed placeholders, `not-sr-only` no longer treated as furniture.
      Result: nav-leak 7→5, boilerplate 3→1, checks 74/74, time unchanged.
- [x] (2026-10-01) Code fidelity: furniture/phrase rules never reach inside `<pre>`/`<code>`
      (Python's `print`, Go/React comments were deleted), inactive code tabs kept and labelled
      (`title="client.ts"`), own `preText` (no blank line per CodeMirror line, Twoslash hover
      cards no longer split tokens onto lines), hidden-math scan made lazy.
      Result: code fence recall 702→735 (frozen metric; see decision log), checks 74/74.
- [ ] Conversion fidelity: tables with block content, display math in paragraphs.
- [ ] Validation: biome, typecheck, tests, build, `bench:compare`, changeset.

## Decision log

- Furniture pass (`takumi.ts`): when removing every unlikely element would cut too deep, retry
  sparing *weak* (class-substring) matches whose link density is below 0.5 instead of skipping the
  pass. Strong matches (roles, chrome tags, `navbox`, exact `breadcrumbs`) never get the reprieve.
  The retry only runs on the already-failing path (4/60 captures), so the common path costs nothing.
- Consent placeholders are matched by anchored opening phrases on elements ≤400 chars, folded into
  the existing mid-article widget check. That check now consults the cached text length before
  building the element's text, so it no longer stringifies every large container.
- Rejected for now: changing the harness `navLinkRatio` to ignore image lines. It would flatter
  every tool's numbers; the site quotes the current definition.
- Hidden code panels are kept only when `role="tabpanel"` or when non-code text is ≤200 chars, so
  a hidden duplicate of the article (mobile layout) is still removed. Tab labels go to the fence
  meta (`title="…"`), matched by `aria-labelledby`/`aria-controls`, else by order when counts agree;
  collected inside the existing noscript traversal, so no extra walk.
- `preText` replaces `hast-util-to-text` for code: a block boundary only ensures a line start
  (a `<br>` closing a line `div` no longer doubles), and blocks inside inline token wrappers do not
  break lines. The frozen `codeFenceRecall` probe splits on every `div`, so on vite-config and
  hono-docs it now picks fragments of the old broken split; that is why recall shows 735, not 737.
  The metric is left unchanged.
