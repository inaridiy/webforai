# ExecPlan: platform landing polish, top-page demo with Markdown preview, docs cross-links

Living document (contract: `.agents/PLANS.md`). Branch: `feat/platform`.
Prior initiative: `.agents/execplans/2026-08-22-platform-docs-cli-client.md`.

## Purpose / Big Picture

Three user-visible outcomes, designed first on a Claude Design canvas the user approved
("ええやん"), then implemented and deployed:

1. **platform.webforai.dev landing polish.** The zinc/oklch token system, components and copy
   stay as they are; the accent tokens change from monochrome ink to the docs site's brand
   blue (`#1f8fff` light / `#4db8ff` dark, expressed in oklch like every other token), and the
   hero becomes a two-column layout with the curl sample on the right.
2. **A public demo on the platform top page.** A "Live demo" section right under the hero:
   URL + region + Convert, backed by the existing unauthenticated `POST /v1/demo/scrape`
   (proxy-fetch engine, 5 req/10 min per IP, truncated output). The result shows the raw
   Markdown and a **rendered preview side by side** — the preview is a small, safe (no
   `dangerouslySetInnerHTML`) Markdown-subset renderer. Initial URL:
   `https://platform.webforai.dev` (user's explicit choice; note the landing is an SPA, so
   converting it yields little content — the prefill is a starting point, not an auto-run).
3. **Cross-links + docs demo tweaks.** platform header/footer link to webforai.dev (Docs);
   the docs landing links to platform.webforai.dev directly; the docs demo section widens
   from `max-w-screen-md` to the hero's `max-w-screen-lg` and its initial URL becomes
   `https://webforai.dev`.

Done means: platform typecheck + tests + build green, site build green, both deployed
(`pnpm --filter platform deploy`, `pnpm --filter site build && worker:deploy`) and the new
copy verified in the deployed bundles.

## Progress

- [x] (2026-08-24) Platform: brand-blue accent tokens in `app.css`.
- [x] (2026-08-24) Platform: `runDemoScrape` in client `lib/api.ts` against `/v1/demo/scrape`.
- [x] (2026-08-24) Platform: Markdown-subset parser (`lib/markdown-preview.ts`, pure + unit
      tests) and renderer (`ui/markdown-preview.tsx`).
- [x] (2026-08-24) Platform: `DemoSection` component + two-column hero in `landing.tsx`,
      Docs cross-links in `site-shell.tsx`.
- [x] (2026-08-24) Docs: demo width `max-w-screen-lg`, default URL `https://webforai.dev`,
      direct link to platform.webforai.dev.
- [x] (2026-08-24) Gates green (biome format+lint clean, platform typecheck OK, 131 platform
      tests passing incl. 7 new parser tests, platform build OK, site build OK).
- [x] (2026-08-24) Deploy both and verify live.
- [x] (2026-08-24) Follow-up per user feedback ("don't hand-roll the previewer"): the
      hand-rolled Markdown parser/renderer (`lib/markdown-preview.ts` + test +
      `ui/markdown-preview.tsx`) is deleted and both demos render with `streamdown@2.5.0`
      (+ its `streamdown/styles.css` animation preset). Platform: Tailwind 4 compiles
      Streamdown's utilities via `@source "../../node_modules/streamdown/dist/*.js"` in
      `app.css`, and the app's existing shadcn-named tokens feed it directly (plus new
      `--color-sidebar[-foreground]` aliases). Docs site (Tailwind 3, no shadcn tokens):
      the preview wraps `<Streamdown controls={false}>` in a `vp-doc` container so vocs'
      own document CSS does the typography. Both demos split YAML frontmatter off before
      rendering (raw remark mangles it) and show it as a mono metadata strip. Docs demo
      also gained the same side-by-side raw/preview layout. Platform client bundle grows
      285→786 kB (89→240 kB gz) — code-splitting the demo section is a known follow-up.
- [x] (2026-08-24) Polish round per user feedback: demo pane height caps loosened
      (platform 28rem→42rem, docs 420px→640px); platform gained `typography.css` (a
      token-based type scale scoped to `.md-preview`, applied to the Streamdown pane —
      Streamdown brings structure, this brings the type); and BOTH sites are now
      deliberately light-only because the preview collapsed in dark mode — platform drops
      the dark token block (`app.css`, restorable from git history), rebinds Tailwind's
      `dark:` variant to a never-present class and ships `color-scheme: light`; the docs
      site sets vocs `theme.colorScheme: "light"` (accentColor is now the single light
      value).
- [x] (2026-08-24) Preview quality round (user screenshot showed the docs preview broken):
      frontmatter is no longer displayed in the preview pane on either site (still stripped
      before rendering); `.md-preview img` gains a 14rem height cap. Root cause of "no
      typography" on docs: vocs ships precompiled styles and nothing in the pipeline carried
      a `@tailwind` directive, so site/tailwind.config.js was never consumed and
      Streamdown's utility classes stayed uncompiled. Fix: `docs/styles.css` (auto-loaded by
      vocs as rootDir/styles.css) now carries `@tailwind utilities` (no `base` — vocs has
      its own preflight), tailwind.config.js scans `node_modules/streamdown/dist/*.js` and
      defines the shadcn-style color names on `--demo-*` channel triplets, and the preview
      wrapper switched from `vp-doc` to the same `.md-preview` type scale as the platform.
      Verified in the built CSS: `bg-muted/80` → `rgb(var(--demo-muted) / .8)` etc. Platform version `5f77bd2f` on
      platform.webforai.dev: deployed JS bundle contains "Try the live demo" / "No conversion
      yet", deployed CSS carries `--accent:oklch(65% .191 253.6)` (light) and
      `oklch(75.1% .141 241.4)` (dark); one live `POST /v1/demo/scrape` for
      https://webforai.dev returned 200 with frontmattered Markdown (which the preview also
      renders). Site version `4a59e959`: prerendered webforai.dev HTML shows the demo section
      at `max-w-screen-lg`, input prefilled with `https://webforai.dev`, and the new
      "Open the platform" button.
