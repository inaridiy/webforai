# Split the CLI out of `webforai` (library) into `webforai-cli`

Owner request (2026-10-09): make webforai easy for other OSS projects to embed by separating
the CLI from the core library and reorganising the docs around that. The integrators' stated
constraints are **dependency count/size** and **runtime portability (Workers, browsers)**.
Owner decisions: `webforai` stays the library name and becomes library-only in a **major**
(5.0.0); the CLI moves to the new package **`webforai-cli`** (bin `webforai`), so
`npx webforai` stops being the CLI; invoking the old package's bin must print that the CLI
moved to `webforai-cli`.

Enduring decisions: `docs/specs/packages.md`.

## Findings before the change (main 643d342)

- `npm i webforai` installs the CLI's runtime deps (`commander`, `@clack/prompts`, `boxen`,
  `picocolors`, ~350 KB) for every library user.
- Bigger: the `playwright-core` peer is `optional: false`, so npm ≥ 7 and pnpm auto-install
  13.6 MB of `playwright-core` for every library user, even those who never import
  `webforai/loaders/playwright`.
- Outside `src/cli`, the library uses no Node built-ins, `process` or `Buffer`.
- The CLI uses only public entry points (`webforai`, `webforai/platform`,
  `webforai/loaders/{fetch,playwright}`), so it can depend on the published package.
- package.json cannot express "install these deps only when run as a CLI": npm, pnpm and
  yarn resolve the same graph for `npx pkg` and `npm i pkg`; `optionalDependencies` are still
  installed by default, and optional peers are skipped by `npx` too.

## Progress

- [x] (2026-10-09) Baseline footprint: `npm i ./webforai-4.3.1.tgz` into an empty project adds
      125 packages, 31 MB of `node_modules` (`playwright-core` 14 MB, `webforai` itself 3.8 MB).
- [x] (2026-10-09) `packages/cli` (`webforai-cli`): sources and tests moved from
      `packages/webforai/src/cli` (git renames), imports switched to `webforai`,
      `webforai/platform` and `webforai/loaders/*`, own esbuild bundle (deps external),
      `playwright-core` as a dependency. 65 CLI tests pass.
- [x] (2026-10-09) `packages/webforai`: CLI deps and sources removed, every loader peer
      optional, `bin` replaced by `bin/moved-to-cli.js` (no imports) that prints the
      `npx webforai-cli <same args>` command and exits 1.
- [x] (2026-10-09) Consumers: Agent Skill (`npx webforai-cli`), platform app snippets and the
      dashboard browser test, `examples/simple`, major changeset for both packages. CI needs no
      change (the library's Playwright loader tests still run in `packages/webforai`).
- [x] (2026-10-09) Docs: root README (packages table), library README rewritten for the npm
      page (entry points, optional peers), new `packages/cli/README.md`, site (installation,
      CLI with v4→v5 note, loaders, cookbooks, new `/embedding` page), `docs/specs/packages.md`,
      platform scope revision note, AGENTS.md.
- [x] (2026-10-09) Validation: biome (no errors), typecheck, `pnpm run test --run` 904 pass /
      3 fail (KI-3 Playwright Chromium build only), `pnpm build`, site build (21 pages),
      platform build + typecheck + 505 unit tests + `test:browser`. Packed tarballs: library-only
      install 100 packages / 14 MB (was 125 / 31 MB), no peers installed by npm or pnpm;
      `npx file:<webforai.tgz>` runs the notice and exits 1; with both tarballs
      `.bin/webforai` is the CLI. esbuild `--platform=browser` bundles of `webforai` (784 KB min,
      285 KB gzip), `webforai/platform` (4 KB), `webforai/loaders/fetch` (1 KB) have no Node
      built-ins and convert in headless Chromium; a Worker using them builds and runs under
      `wrangler dev` without `nodejs_compat`.

Not done here (owner, at release): first publish of `webforai-cli` may need a manual
`npm publish` before npm trusted publishing can be configured for the new package.

## Decision log

- (2026-10-09) The CLI package is **`webforai-cli`**, not `@webforai/cli`: the owner could not
  create the npm org `webforai` ("organization name is not available"; the scope was already
  noted as unavailable in `docs/specs/platform/01_scope.md`, 2026-08-22). Renaming the project
  was considered and rejected — npm history, webforai.dev, the platform and billing all carry
  the name. Unscoped `<name>-cli` follows `netlify-cli`. The command stays `webforai`.

- (2026-10-09) The CLI keeps `playwright-core` as a regular dependency, matching what
  `npx webforai@4` installed (the non-optional peer); the footprint goal is the library's.
- (2026-10-09) The notice bin in `webforai` is named `webforai-moved`, not `webforai`:
  `npx webforai` runs a package's only bin whatever its name, and a distinct name cannot
  collide with `webforai-cli`'s `webforai` bin in a `node_modules/.bin` that has both.
- (2026-10-09) `packages/cli/tsconfig.json` uses `skipLibCheck: true`: pnpm resolved its
  `typescript@^5.4.5` to 5.9.3 (already in the lockfile), whose lib types reject
  `@types/node@20`'s d.ts. The library keeps `skipLibCheck: false` and checks its own d.ts.
- (2026-10-09) `webforai-cli` starts at the same version line (5.0.0) so `webforai --version`
  continues from 4.3.1.
