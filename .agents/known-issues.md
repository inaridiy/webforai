# Validation diagnostics

Reviewed 2026-09-06 during [the quality review](execplans/2026-09-06-quality-review.md).
These entries describe specific diagnostics; errors or different runtime failures are not covered.

## KI-1: Biome advisory rules

`pnpm lint` exits 0 with advisory warnings. The review fixed all error-level formatting,
import ordering, and implicit-any findings. Remaining rule families are naming (including
external Stripe/Cloudflare fields), block-statement style, async test doubles without an
await, deliberate empty promise callbacks, schema namespace/barrel exports, parameter
properties, simplified logical expressions, and two unused playground suppression comments.
They are not a reason to rename external wire fields or apply broad unsafe autofixes.
Owner: repository maintainers; narrow lint cleanup may revisit these advisory conventions.
Run `pnpm exec biome check --reporter=json --max-diagnostics=1000 .` to inspect new signals.

## KI-2: Deferred Markdown renderer chunk

`pnpm --filter platform build` exits 0 and reports a >500 kB chunk. The preview renderer
is now loaded only when a result is displayed; measured initial JavaScript decreased from
857.87 kB (258.51 kB gzip) before splitting to 354.39 kB (108.74 kB gzip). The deferred
renderer is 502.59 kB (149.68 kB gzip). Keep the warning enabled to reveal future growth;
this specific deferred vendor chunk is accepted. Revisit if preview loading itself becomes
a measured UX problem. No Core Web Vitals claim follows from these bundle sizes.

## Resolved diagnostics and command corrections

- Root Vite CJS deprecation: root config is now `vitest.config.mts`, so Vite loads it as ESM.
- Node 24 / Vitest 1 thread teardown could abort in `v8::ToLocalChecked` / `cjs_lexer`
  after passing assertions. Root and platform unit configurations use one fork process;
  the complete 446-test integrated run and 193-test platform run exited 0 without the crash.
- `pnpm test --run` is rejected by this pnpm version before tests start. Use
  `pnpm run test --run`; AGENTS.md and CI use this working command.
- Prerender's middleware-mode Vite server previously opened HMR port 24678 and collided
  with other local validation. Prerender and the isolated browser test disable HMR.

## Accepted similarity signals

`similarity-ts packages/webforai/src apps/platform/src --threshold 0.9 --types --classes --suggest`
reported two structural function pairs: artifact/demo route factories share framework
control flow but different authorization/data contracts; artifact route/custom anchor
handler is a structural false positive. Twelve type pairs are intentional SDK/server DTOs,
Hono environment declarations, and billing input/state projections. Keep the library
independent of platform internals. No shared Error superclass is needed merely because
three errors extend Error. No knip/dependency-cruiser installation or retrofit was added.
