# Agent-extractor follow-up: library interface, platform presets, PlatformRpc `tryConvert`

Follows the `feat/agent-extractor` commits (kiwame sequence model, `agentExtractor`,
`readabilityExtractor`). Three things: tidy the library's public interface around the new
extractors, let the platform offer them, and give `PlatformRpc` the contract Re:Babel's
born-digital ingest is written against (`~/remake-rebabel/.agents/execplans/2026-10-03T1421Z_born-digital-ingest.md`,
section "理想 PlatformRpc 契約" and its "webforai TODO" list).

## Progress

- [x] (2026-10-05) Library: one list of extractor preset names (`EXTRACTOR_PRESETS`) and resolver
      (`presetExtractors`), shared by the CLI and the platform; root exports the types the new
      options mention (`ScoredPage`, `RoleModels`, `LINK_ROLE_TITLES`); `webforai/platform`
      gains the new presets, `extraction` on scrape results, and the RPC wire types.
- [x] (2026-10-05) Platform: REST/playground/RPC accept every preset; scrape results carry `extraction`;
      both browser engines annotate rendered geometry before reading the DOM.
- [x] (2026-10-05) PlatformRpc: `tryConvert` (errors as data), `frontmatter`/`titleHeading`, unknown option
      keys ignored, typed metadata with ISO dates, `extraction`, coded `warnings[]`, `images[]`,
      errors with `httpStatus`/`contentType`/`retryable`. `convert` keeps throwing.
- [x] (2026-10-05) Docs: site (htmlToMarkdown options and presets, CLI, cookbook, platform API), READMEs,
      skill, specs revision notes; changesets.
- [x] (2026-10-05) Gates: biome (no new warnings), typecheck, `pnpm run test --run` 872/875
      (the 3 failures are KI-3, Playwright's pinned Chromium is not installed), platform 505
      tests + build, site build (twoslash examples compile).
- [ ] Owner: deploy the platform (TODO 7 of the Re:Babel plan), then release the library
      (the CLI now sends `agent`/`kiwame`/`readability` to the platform).

## Decision log

- (2026-10-05) The library option stays `title` (published since 3.0); the RPC's `titleHeading`
  maps onto it. Renaming would break callers for no behavioural gain.
- (2026-10-05) RPC types live in `webforai/platform` (types only, no runtime coupling) and the
  platform's implementation is checked against them, so the published types cannot drift from
  the deployment. Prefixed `Rpc*` because `ConvertOptions` already names the REST `convert` object.
- (2026-10-05) Error retryability (`retryable`) follows the async jobs' rule: `invalid_*`,
  `unsupported_content_type`, `response_too_large` and an exhausted `auto` escalation are final;
  `fetch_failed` is final for an upstream 4xx other than 408/425/429, transient otherwise;
  `rate_limited`, `engine_failed`, `engine_unavailable` and `internal_error` are transient.
- (2026-10-05) Warning codes: `client_shell_unrendered` (fetch-tier shell left unrendered),
  `browser_timeout` (the render budget ran out before the network went idle; the DOM read then
  is returned), `low_confidence` (kiwame confidence below 0.5), `meta_refresh_followed`.
- (2026-10-05) `extraction.textLength` counts the markdown body (front matter removed, trimmed);
  `extraction.extractor` falls back to the preset name for presets that report nothing
  (`none`, `minimal`). `images[]` skips fenced code and private/local targets.
- (2026-10-05) Webforai TODOs of the Re:Babel plan done here: 1–6, 8 (types in
  `webforai/platform`), 9 (tenants in `02_architecture.md`). 7 (deploy) is the owner's.
