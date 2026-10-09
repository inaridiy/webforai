---
"webforai": major
"webforai-cli": major
---

**The CLI moved to its own package, `webforai-cli`; `webforai` is now the library only.**

`webforai` no longer installs the CLI's dependencies (`commander`, `@clack/prompts`, `boxen`,
`picocolors`), and every loader peer — including `playwright-core`, which npm 7+ and pnpm used to
install automatically — is now optional. Installing the library for `htmlToMarkdown` no longer
pulls in a 14 MB browser driver.

Migrating:

- **CLI:** run `npx webforai-cli <url>` (or `npm i -g webforai-cli`; the command is still
  `webforai`). Flags, output and exit codes are unchanged. `npx webforai` now only prints this
  migration hint and exits with code 1.
- **Agent Skill:** reinstall it with `npx webforai-cli skill --install` so it calls the new package.
- **Library:** no code changes. If you import `webforai/loaders/playwright`, add `playwright-core`
  to your own dependencies (`npm i playwright-core`); the Puppeteer loaders already needed this.
