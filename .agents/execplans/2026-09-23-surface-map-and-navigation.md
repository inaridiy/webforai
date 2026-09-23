# ExecPlan: surface map and cross-surface navigation

Living document (contract: `.agents/PLANS.md`). Branch: `feat/platform`.
Start revision: `83f805a`.

## Purpose / Big Picture

webforai is one project reached through six surfaces, and users currently cannot tell which
one they are on or how to get to the next. The motivating defect (owner report, 2026-09-23):
on https://webforai.dev the header "Platform" entry opens the *platform docs*, not the
platform product, and nothing above the fold tells a visitor that a hosted API exists.

Outcome: every surface names what it is, and links to the others under labels that say
where the link goes (product vs. docs). Concretely:

1. **Docs site (webforai.dev)** — header gets a "Platform" dropdown that separates the
   product ("Open platform ↗", "Dashboard ↗") from its docs ("Platform docs", "API
   reference"); the landing gains a "three ways to use webforai" block (library / CLI /
   hosted API) right under the hero; the platform docs overview opens with a callout that
   links to the product and dashboard.
2. **Platform SPA (platform.webforai.dev)** — "Docs" goes to the *platform* docs
   (webforai.dev/platform) instead of the library docs root; the landing shows how to call
   the API from curl / TypeScript / CLI with doc links; the dashboard carries a quickstart
   card (what to do with a key); the revealed-key box shows next steps; footer links the
   library, CLI and self-hosting docs; mobile gets the docs links too.
3. **CLI** — `--help` names the docs and the dashboard; auth/credit errors print a hint
   pointing at the dashboard.
4. **READMEs** — root and package READMEs open with a "which surface do I need" table;
   `site/README.md` replaces the Vocs boilerplate with what the site is and how to run and
   deploy it.
5. **Spec** — the surface map and naming/linking rules are recorded as an enduring decision
   in `docs/specs/platform/01_scope.md` (revision note).

Out of scope: deploying the site or platform (outward-facing; the owner deploys), visual
redesign, new routes.

## Surface map (the design)

| surface | where | audience | job |
| --- | --- | --- | --- |
| Library `webforai` | npm, `packages/webforai` | developers converting HTML themselves | `htmlToMarkdown`, loaders, adapters |
| CLI `npx webforai` | same npm package (`bin`) | shell users, AI agents | one command URL→Markdown; `--engine` uses the platform |
| Platform client `webforai/platform` | same npm package (subpath) | apps calling the hosted API | typed HTTP client |
| Docs site | webforai.dev (`site/`) | everyone | the only documentation, for all three above + the platform API |
| Platform product | platform.webforai.dev (`apps/platform`) | API customers | landing/pricing, signup, dashboard (keys, usage, billing, jobs), playground |
| READMEs | GitHub / npm | first contact, contributors, self-hosters | route to the docs site; `apps/platform` README = run/deploy your own |

Linking rules:

- "Docs" on the platform means the platform docs (webforai.dev/platform); "Library docs"
  means webforai.dev/getting-started.
- A link that leaves the docs site for the product says so ("Open platform", "Dashboard",
  external arrow) — never the bare word "Platform" for both.
- Every platform-facing error or empty state that needs a key or credits names the
  dashboard.

## Progress

- [x] (2026-09-23) Survey: site config/pages, platform SPA shell/landing/dashboard, CLI
      help/errors, READMEs, live site. Plan authored.
- [x] (2026-09-23) Docs site: nav dropdown, landing "ways to use" block, platform docs
      callout, dashboard links, demo caption fix, site README. Site build green. b7b31a0.
- [x] (2026-09-23) Platform SPA: nav/footer targets, landing clients section, dashboard
      quickstart, revealed-key next steps. Platform typecheck + 193 tests + build +
      test:browser green. 1ef421f.
- [x] (2026-09-23) CLI help/hints (+ test, changeset) + READMEs + spec section. 23b15d0.
- [x] (2026-09-23) Integrated validation: root 447 tests, typecheck, library build, site
      build. Screenshots of site landing/dropdown/platform docs (desktop+mobile) and platform
      landing/dashboard (desktop+mobile) reviewed. Specs drift: only 01_scope changed.

## Decision log

- Sidebar keeps only internal links: vocs 1.0.0-alpha.61 renders sidebar items through
  react-router `Link`, so external product links go in the top-nav dropdown (vocs `Link`,
  which handles external URLs and adds the arrow icon).
- The live site still shows the pre-`c09a5fd` header (Platform → /platform). The repo fix
  was never deployed; this plan supersedes it with the dropdown. Deployment stays with the
  owner.
- CLI hints hard-code the hosted dashboard URL only when `--platform-url` is the default;
  for self-hosted base URLs the hint uses `<platform-url>/dashboard`.

## Surprises & discoveries

- Importing `vocs/components` from a `.tsx` module under `site/docs/components` breaks
  `vocs build` prerendering ("Received protocol 'virtual:'"); MDX pages can import it. The
  landing passes `HomePage.Button` into `WaysToUse` as a prop.
- The docs-site demo caption said it ran `proxy-fetch`; the demo has run `auto` since
  2026-08-24.
- `vocs preview` crashes on Node 24 here; static `docs/dist` served by any file server is
  enough for screenshots.

## Validation

`pnpm --filter site build`; `pnpm --filter platform typecheck && pnpm --filter platform test
&& pnpm --filter platform build`; `pnpm run test --run`; `pnpm typecheck`; `pnpm build`;
biome. Dashboard screenshots via `pnpm --filter platform test:browser` if it runs locally.

## Outcomes & retrospective

All five outcomes shipped as planned. Not done here: deploying webforai.dev and
platform.webforai.dev — the live docs header still points "Platform" at /platform until
the owner runs `pnpm --filter site build && pnpm --filter site worker:deploy` (and
`pnpm --filter platform run deploy` for the app).
