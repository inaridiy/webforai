#!/usr/bin/env node
// Since webforai 5 this package is the library only; the CLI lives in webforai-cli.
// `npx webforai ...` runs this file (a package's only bin, whatever its name) and says where
// the CLI went instead of failing with npm's "could not determine executable to run".
// No imports: it must run without installing anything else.

const quote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);
const args = process.argv.slice(2).map(quote).join(" ");

process.stderr.write(
	[
		"The webforai CLI has moved to the webforai-cli package.",
		"",
		`  npx webforai-cli${args ? ` ${args}` : ""}`,
		"",
		"or install it once: npm i -g webforai-cli  (the command is still `webforai`).",
		'The webforai package is now the library only: import { htmlToMarkdown } from "webforai".',
		"Details: https://webforai.dev/cli",
		"",
	].join("\n"),
);
process.exitCode = 1;
