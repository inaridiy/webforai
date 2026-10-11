# Docs lead with value: READMEs, webforai.dev landing, platform landing

Owner request (2026-10-11): the README on PR #87 is "not essential" — it reads as a report of
the PR's work, not as the entry point to webforai. Rewrite it around what a README is for, then
make every other user-facing intro follow. Stacked on `release/v5` (PR #87).

## Principles (from the owner's paragraph-by-paragraph review)

1. **Lead with value, not mechanism.** Tagline "Any HTML to the cleanest Markdown, for humans and
   AI agents." and four claims: Best quality · Most token-efficient · Near-top speed · Pure
   TypeScript. ("Pure ESM" was rejected: the package also ships CommonJS.)
2. **Two modes, said in terms the reader knows.** Reader mode: the main content, like Mozilla
   Readability, best quality of the converters benchmarked. Agent mode: adds only the links an
   agent needs to explore the site, about half the tokens of the whole page (2,426 against
   4,350–4,533 median tokens: "2×" would overstate it).
3. **Show real output before explaining it.** The README carried no converted Markdown at all.
   A "What you get" section shows an abridged agent-mode conversion of a live page; the modes
   are then described as "how much of this output".
4. **Numbers plainly, method on `/benchmarks`.** No SIGIR citation, no "60 cached real pages",
   no reproduction notes in the README. The WCEB 0.923 keeps the one clause that makes it
   honest: "keeping reader comments, as Trafilatura does".
5. **No `comments` preset in intros.** It lives in the presets reference and on `/benchmarks`.
6. **No "Why webforai" section.** Benchmarks are the why; site adapters and markup rules go to
   the docs. "Try it live" links to `https://webforai.dev/#demo`.
7. Quick start first, then output, then benchmarks, then the three ways to use it.

## Progress

- [x] (2026-10-11) Library: link labels separate adjacent child elements with a space
      (`textOf` in `roles.ts`), so VitePress pager links read "Next page Server-Side Rendering"
      instead of "Next pageServer-Side Rendering". Needed before quoting real output in the README.
- [ ] `README.md`, `packages/webforai/README.md`, `packages/cli/README.md`; `cli.mdx` still named
      the `readability` preset and left out `reader`.
- [ ] `site/docs/pages/index.mdx` (hero, benchmarks copy, section order), `getting-started.mdx`
      intro, `DemoScrape.tsx` idle copy, platform `landing.tsx` hero.
- [ ] Checks: biome, typecheck, webforai tests, site build, platform typecheck + tests + build.

## Decision log

- (2026-10-11) The speed claim returns to the opening ("Near-top speed", 4.0 s against
  Readability + Turndown's 13.7 s). This reverses the 2026-10-11 review-fix decision to drop it:
  the owner's tagline asks for it, and it is stated with the comparison that makes it checkable.
  "Fastest in JS" is not claimed: full-page Turndown (no extraction) is faster.
- (2026-10-11) The output sample is vite.dev/guide/env-and-mode in agent mode, abridged with
  "…" and nothing else changed. Its Related section lists a ViteConf banner; the abridgement
  leaves that part out, as it leaves most of the article out.
- (2026-10-11) The agent-mode table drops the "every link" row and the reader-mode extractors'
  5–12% row: the first is a harness variant, the second compares against tools that drop links
  by design and needed a sentence of apology.
- (2026-10-11) "Developed with Claude Code, labels made with Codex" leaves the README.
