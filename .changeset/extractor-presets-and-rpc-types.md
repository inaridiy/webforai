---
"webforai": minor
---

One list of extractor presets for the library, the CLI and the hosted platform.

- `EXTRACTOR_PRESETS` (`auto`, `readability`, `agent`, `kiwame`, `takumi`, `minimal`, `none`) and
  `presetExtractors(name)`, which returns the `extractors` option for a preset name.
- The root export now includes the types the extractor options mention: `ScoredPage` (for
  `onScored`), `RoleModels` (for `roleModels`), and `LINK_ROLE_TITLES`.
- CLI: every `--extractor` preset works with `--loader platform` and the `crawl`/`batch` jobs
  (`agent`, `kiwame` and `readability` were local-only or rejected); `--json` includes
  `extraction` (which extractor ran and kiwame's confidence).
- `webforai/platform`: `ExtractorPreset` covers every preset, scrape results carry
  `extraction`, and the types of the internal `PlatformRpc` Service Binding entrypoint are
  exported (`PlatformRpc`, `RpcConvertOptions`, `RpcConvertResult`, `RpcConvertOutcome`,
  `RpcConvertError`, warning and error codes).
