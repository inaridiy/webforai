---
"webforai": major
---

Rebuild the CLI for automation-first use.

- **Non-interactive by default**: `npx webforai <url>` converts and prints Markdown to
  stdout (logs go to stderr); `-o <path>` writes a file. The guided wizard now lives behind
  `-i`/`--interactive`.
- **`--json`** emits a machine-readable envelope (`source`, `loader`, `url`, `markdown`,
  `metadata`, plus platform fields).
- **Platform loader**: `-l platform` (or just `--engine`/`--region`) converts via the hosted
  webforai platform using the new `@webforai/platform` client; API key from `--api-key` or
  `WEBFORAI_API_KEY`, self-hosted deployments via `--platform-url`/`WEBFORAI_PLATFORM_URL`.
- **Agent Skills**: `webforai skill` prints an Agent Skill for this CLI; `webforai skill
  --install` installs it through Vercel's `skills` CLI (`npx skills add`), and
  `npx skills add inaridiy/webforai` works straight from the repository.
- New conversion flags: `--extractor auto|takumi|minimal|none`, `--frontmatter`,
  `--screenshot` (platform browser engines).
- `-h` documents every flag with examples, env vars and exit codes (0 ok / 1 runtime /
  2 usage).
- Dropped the unused `zx` dependency.
