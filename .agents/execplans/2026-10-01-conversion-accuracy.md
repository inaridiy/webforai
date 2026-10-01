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
- [ ] Conversion fidelity: code blocks and tables.
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
