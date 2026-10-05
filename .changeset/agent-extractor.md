---
"webforai": minor
---

`agentExtractor`: main content for AI agents, plus the links they may follow.

- Keeps exactly the main content of the default extractor, then appends reader comments
  (`## Comments`) and the page's other links under `## Links`, grouped as Related, Pagination,
  Section navigation, Breadcrumb and Site navigation. Share buttons, ads, sign-up and legal links are
  left out; each link is listed once, under its most specific role.
- Roles come from small per-role models (about 100 KB, loaded only when `agentExtractor` or
  `createAgentExtractor` is imported); `createAgentExtractor({ roles, comments, roleModels })`
  chooses the groups, and `roleModels: null` falls back to class/aria hints.
- `readabilityExtractor` names the default main-content extractor (same as `autoExtractor`).
- CLI: `--extractor agent` and `--extractor readability` (local conversion).
- `createKiwameExtractor` accepts `onScored`, called with the scored blocks before pruning.
