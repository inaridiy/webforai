import { type Command, CommanderError, program } from "commander";
import { DEFAULT_BASE_URL, PlatformApiError } from "webforai/platform";
import packageInfo from "../package.json";
import { type JobFlags, resolveJobOptions } from "./commands/jobs/options";
import { JobIncompleteError, runJobCommand } from "./commands/jobs/run";
import { type SkillFlags, skillCommand } from "./commands/skill";
import { interactiveCommand } from "./commands/webforai/interactive";
import { type CliFlags, UsageError, resolveRunOptions } from "./commands/webforai/options";
import { runCommand } from "./commands/webforai/run";
import { API_KEY_ENV, EXTRACTORS, LOADERS, MODES, PLATFORM_URL_ENV } from "./constants";
import { platformDashboardUrl } from "./utils";

const HELP_EPILOGUE = `
Examples:
  $ webforai https://example.com/article              Markdown to stdout
  $ webforai https://example.com -o article.md        write to a file
  $ webforai ./page.html --extractor none             convert a local file, no extraction
  $ webforai https://example.com --json | jq .markdown
  $ webforai https://spa.example.com -l playwright    render JS in local Chromium
  $ webforai https://example.com --engine auto        hosted platform, renders JS when needed
  $ webforai crawl https://docs.example.com -o docs --llms-txt   crawl a site (platform) + llms.txt
  $ webforai batch --file urls.txt -o pages           many URLs, one .md per page (platform)
  $ webforai -i                                       guided interactive mode
  $ webforai skill --install                          install the Agent Skill for this CLI

Environment:
  ${API_KEY_ENV}        platform API key (used by the platform loader)
  ${PLATFORM_URL_ENV}   platform base URL override (self-hosted deployments)

Exit codes:
  0 success · 1 runtime failure · 2 usage error

Output contract:
  stdout carries only the Markdown (or the --json envelope); all logs go to stderr.

Docs:
  https://webforai.dev/cli                    this CLI
  https://webforai.dev/platform               the hosted platform (--engine / --region)
  ${DEFAULT_BASE_URL}/dashboard     API keys, usage and billing
`;

/** Platform errors the user fixes on the dashboard rather than by retrying. */
const DASHBOARD_ERRORS = new Set(["invalid_api_key", "payment_required", "spend_cap_reached"]);

/** `--platform-url` of whichever command ran (root or subcommand), else the environment. */
let activePlatformUrl: string | undefined;
const rememberPlatformUrl = (flags: { platformUrl?: string }) => {
	activePlatformUrl = flags.platformUrl ?? process.env[PLATFORM_URL_ENV];
};

program
	.name("webforai")
	// Root flags (-o, --engine, ...) must not swallow the same-named flags of `crawl`/`batch`.
	.enablePositionalOptions()
	// Before any .command(): subcommands copy this setting when they are created.
	.exitOverride()
	.description("Convert web pages and local HTML to clean, LLM-ready Markdown.")
	.version(packageInfo.version, "-v, --version", "output the current version")
	.addHelpText("after", HELP_EPILOGUE)
	.showSuggestionAfterError();

program
	.argument("[source]", "URL or local HTML file to convert")
	.option("-o, --output <path>", "write Markdown to a file instead of stdout")
	.option("-l, --loader <loader>", `how HTML is acquired (${LOADERS.join(" | ")}; local files are automatic)`)
	.option("-m, --mode <mode>", `conversion mode (${MODES.join(" | ")}); ai strips links/tables/images`)
	.option("--extractor <extractor>", `main-content extraction preset (${EXTRACTORS.join(" | ")})`, undefined)
	.option("--frontmatter", "prepend YAML front matter built from the page metadata")
	.option("--json", "print a JSON envelope {source, loader, url, markdown, metadata, ...} to stdout")
	.option(
		"--engine <engine>",
		"platform engine (auto | fetch | browser | proxy-fetch | proxy-browser; proxy-* need a paid plan); implies -l platform",
	)
	.option("--region <region>", "platform proxy egress region (auto | jp; jp needs a paid plan); implies -l platform")
	.option("--screenshot", "platform browser engines: also capture a screenshot (expiring URL)")
	.option("--respect-robots", "platform loader: honor the target site's robots.txt rules (off by default)")
	.option("--api-key <key>", `platform API key (defaults to $${API_KEY_ENV})`)
	.option("--platform-url <url>", `platform base URL (defaults to $${PLATFORM_URL_ENV} or the hosted instance)`)
	.option("-i, --interactive", "guided prompt flow (the pre-v3 default)")
	.option("-d, --debug", "verbose logs on stderr")
	.action(async (source: string | undefined, flags: CliFlags & { interactive?: boolean }) => {
		rememberPlatformUrl(flags);
		if (flags.interactive) {
			await interactiveCommand(source, flags);
			return;
		}
		if (!source) {
			program.help({ error: true });
		}
		await runCommand(resolveRunOptions(source, flags));
	});

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

/** Flags `crawl` and `batch` share with each other (and, in meaning, with the root command). */
const addPlatformJobOptions = (command: Command): Command =>
	command
		.requiredOption("-o, --output <dir>", "directory for the Markdown files (one per page; created if missing)")
		.option(
			"--engine <engine>",
			"platform engine (auto | fetch | browser | proxy-fetch | proxy-browser; proxy-* need a paid plan)",
		)
		.option("--region <region>", "proxy egress region (auto | jp); jp runs on the paid proxy tier")
		.option("--extractor <extractor>", `main-content extraction preset (${EXTRACTORS.join(" | ")})`)
		.option("--frontmatter", "prepend YAML front matter built from each page's metadata")
		.option("--json", "print a JSON envelope {jobId, pages[], failures[], ...} to stdout instead of file paths")
		.option("--timeout <seconds>", "stop waiting after this long (the job keeps running); default 1800")
		.option("--api-key <key>", `platform API key (defaults to $${API_KEY_ENV})`)
		.option("--platform-url <url>", `platform base URL (defaults to $${PLATFORM_URL_ENV} or the hosted instance)`)
		.option("-d, --debug", "verbose logs on stderr");

const JOB_OUTPUT_HELP = `
Output:
  One .md per converted page under --output, mirroring URL paths (/docs/intro → docs/intro.md).
  stdout lists the written files (or the --json envelope); progress and the summary go to stderr.
  Exit 1 when the job failed or converted no pages; failed pages are listed and never billed.
`;

addPlatformJobOptions(
	program
		.command("crawl")
		.description("crawl a site on the hosted platform and write one Markdown file per page")
		.argument("<url>", "seed URL; only same-origin links are followed"),
)
	.option("--max-depth <n>", "link depth from the seed (0-5, default 2)")
	.option("--limit <n>", "maximum pages (1-500, default 50)")
	.option("--include <regex>", "only crawl pathnames matching this regex (repeatable)", collect)
	.option("--exclude <regex>", "skip pathnames matching this regex (repeatable)", collect)
	.option(
		"--sitemap <mode>",
		"use the site's sitemaps: skip (default) | include (add their URLs) | only (no link following)",
	)
	.option("--respect-robots", "honor robots.txt (the default for crawls)")
	.option("--no-respect-robots", "do not read robots.txt")
	.option("--llms-txt", "also write llms.txt (page index) and llms-full.txt (all pages) per llmstxt.org")
	.addHelpText(
		"after",
		`${JOB_OUTPUT_HELP}
Examples:
  $ webforai crawl https://docs.example.com -o docs --limit 100 --include '^/docs' --llms-txt
  $ webforai crawl https://blog.example.com -o blog --sitemap only --limit 500
`,
	)
	.action(async (url: string, flags: JobFlags) => {
		rememberPlatformUrl(flags);
		await runJobCommand(resolveJobOptions("crawl", [url], flags));
	});

addPlatformJobOptions(
	program
		.command("batch")
		.description("convert many URLs on the hosted platform, one Markdown file per page")
		.argument("[urls...]", "URLs to convert (up to 100 per job)"),
)
	.option("-f, --file <path>", "read URLs from a file, one per line ('-' for stdin; # comments allowed)")
	.option("--respect-robots", "honor each site's robots.txt (off by default for batches)")
	.addHelpText(
		"after",
		`${JOB_OUTPUT_HELP}
Examples:
  $ webforai batch https://a.example/post https://b.example/news -o pages
  $ cat urls.txt | webforai batch --file - -o pages --json
`,
	)
	.action(async (urls: string[], flags: JobFlags) => {
		rememberPlatformUrl(flags);
		await runJobCommand(resolveJobOptions("batch", urls, flags));
	});

program
	.command("skill")
	.description("print the Agent Skill (SKILL.md) for this CLI, or install it via the skills CLI")
	.option("--install", "install through `npx skills add` (interactive agent picker; flags below forward to it)")
	.option("-g, --global", "forward to skills add: install user-level instead of project-level")
	.option("-a, --agent <agents>", "forward to skills add: agents to install to ('*' for all)")
	.option("-y, --yes", "forward to skills add: skip confirmation prompts")
	.option("--copy", "forward to skills add: copy files instead of symlinking")
	.option("--all", "forward to skills add: all skills, all agents, no prompts")
	.option("--dir <path>", "offline fallback: write <path>/webforai/SKILL.md directly, without the skills CLI")
	.addHelpText("after", "\nAlso installable straight from the repository: npx skills add inaridiy/webforai\n")
	.action(async (flags: SkillFlags) => {
		await skillCommand(flags);
	});

const fail = (error: unknown): never => {
	if (error instanceof CommanderError) {
		// Help/version are successful exits; anything else is a usage mistake.
		process.exit(error.exitCode === 0 ? 0 : 2);
	}
	if (error instanceof UsageError) {
		console.error(`error: ${error.message}`);
		process.exit(2);
	}
	if (error instanceof PlatformApiError) {
		const retry = error.retryAfter === undefined ? "" : ` (retryAfter: ${error.retryAfter}s)`;
		console.error(`error: ${error.code}: ${error.message}${retry}`);
		// The platform client already names the dashboard in 401/402 messages; never twice.
		if (DASHBOARD_ERRORS.has(error.code) && !error.message.includes("/dashboard")) {
			console.error(`hint: manage API keys and credits at ${platformDashboardUrl(activePlatformUrl)}`);
		}
		process.exit(1);
	}
	if (error instanceof JobIncompleteError) {
		console.error(`error: ${error.message}`);
		process.exit(1);
	}
	console.error(error instanceof Error ? `error: ${error.message}` : `error: ${String(error)}`);
	process.exit(1);
};

program.parseAsync().catch(fail);
