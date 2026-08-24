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
- [ ] (2026-08-24) Deploy both and verify live.
