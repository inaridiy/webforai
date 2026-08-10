# AGENTS

When writing complex features or significant refactors, use an ExecPlan (as described in
.agents/PLANS.md) from design to implementation.

## Toolchain

- `pnpm install` — workspace install (pnpm 9, `preinstall` enforces pnpm).
- `pnpm format:fix` / `pnpm lint:fix` — biome; run before committing.
- `pnpm typecheck` — tsc across packages.
- `pnpm test` — vitest at repo root (library tests). Platform tests:
  `pnpm --filter platform test`.
- `pnpm build` — builds `packages/**`. Platform: `pnpm --filter platform build`.
- Platform local dev: `pnpm --filter platform dev` (wrangler/vite; containers need Docker).

When touching `apps/platform`, run its typecheck + tests + build before calling work done.
When a diff changes any command, env var, binding, port, or user flow mentioned in a
README.md, update that README in the same commit.

## Where things live

- `packages/webforai` — the published library (html→markdown). Do not couple it to the
  platform; the platform consumes it via `workspace:*`.
- `apps/platform` — the Cloudflare SaaS platform. Design ledger: `docs/specs/platform/`.
- Enduring decisions go to `docs/specs/**` with a dated `Revision note (YYYY-MM-DD): ...`;
  workflow rules live here; task history lives in `.agents/execplans/`.
- Platform assumptions: production is Cloudflare Workers — no cross-request in-process state,
  no Node-only APIs outside `*.container.ts` files, secrets only via wrangler secrets/typed env.

## Task delegation

- Commit at every completed ExecPlan Progress step; conventional commits; never `git add -A`
  in a mixed worktree — stage explicit paths.
- Delegate parallelizable or long-gather/short-output work (research, broad reviews, test
  runs) to subagents; keep work that builds needed context inline.

## Review

- Before merging significant platform changes: biome + typecheck + tests + build, plus a pass
  over `docs/specs/platform` for drift (update with revision notes, don't rewrite history).
- Aim for the intended design: when a Cloudflare primitive or library has a clear intended
  model (Workflows steps, Better Auth plugins, drizzle migrations), investigate failures
  within that model before hand-rolling a replacement.
