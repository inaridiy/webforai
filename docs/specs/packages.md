# Published packages

Decided 2026-10-09 (owner request: make webforai easy for other OSS projects to embed).
History: `.agents/execplans/2026-10-09-split-core-cli.md`.

| npm package | source | contents |
| --- | --- | --- |
| `webforai` | `packages/webforai` | the library: conversion API, extractors, site adapters, `webforai/loaders/*`, `webforai/platform` |
| `webforai-cli` | `packages/cli` | the `webforai` command; depends on `webforai` through its public entry points only |

## Rules for `webforai` (the library)

- **No CLI code or CLI dependencies.** Anything that exists for a terminal (argument parsing,
  prompts, colours, boxes, file output) goes in `webforai-cli`.
- **Every peer dependency is optional.** Browser drivers (`playwright-core`, `puppeteer`,
  `@cloudflare/puppeteer`) are imported only by their own `webforai/loaders/*` subpath; the
  user installs the one they import. A non-optional peer is auto-installed by npm ≥ 7 and pnpm
  for every user, which is what this rule prevents (it cost 14 MB of `playwright-core` in v4).
- **No Node.js built-ins outside Node-only loaders.** `webforai`, `webforai/platform` and
  `webforai/loaders/fetch` must bundle for `platform=browser` and run in Cloudflare Workers
  without `nodejs_compat`. Node-only code belongs in a loader subpath or in the CLI.
- **A new runtime dependency needs a reason.** The integrators' constraint is install size and
  dependency count; prefer the existing unified/hast/mdast utilities, and say in the PR what
  the dependency adds to a fresh `npm i webforai`.

## Rules for `webforai-cli`

- Imports `webforai`, `webforai/platform` and `webforai/loaders/*` — never library source
  paths — so that anything it needs is public API of the library.
- Flags, stdout/stderr contract and exit codes are documented on webforai.dev/cli and in the
  Agent Skill (`skills/webforai/SKILL.md`, generated from `packages/cli/src/commands/skill`).
- Keeps `playwright-core` as a regular dependency so `-l playwright` works under `npx`.

## Versioning

Both packages are versioned by changesets on the same major line (`webforai-cli` started at
5.0.0, continuing `webforai --version` from the 4.x CLI). A breaking change in either is a major
of that package.

The `webforai` package keeps a zero-dependency bin (`webforai-moved`, `bin/moved-to-cli.js`)
so that `npx webforai …` prints the equivalent `npx webforai-cli …` command and exits 1
instead of failing with npm's "could not determine executable". It may be removed in a later
major.
