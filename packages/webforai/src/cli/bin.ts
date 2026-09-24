import { CommanderError, program } from "commander";
import packageInfo from "../../package.json";
import { DEFAULT_BASE_URL, PlatformApiError } from "../platform";
import { type SkillFlags, skillCommand } from "./commands/skill";
import { interactiveCommand } from "./commands/webforai/interactive";
import { type CliFlags, UsageError, resolveRunOptions } from "./commands/webforai/options";
import { runCommand } from "./commands/webforai/run";
import { API_KEY_ENV, EXTRACTORS, LOADERS, MODES, PLATFORM_URL_ENV } from "./constants";

const HELP_EPILOGUE = `
Examples:
  $ webforai https://example.com/article              Markdown to stdout
  $ webforai https://example.com -o article.md        write to a file
  $ webforai ./page.html --extractor none             convert a local file, no extraction
  $ webforai https://example.com --json | jq .markdown
  $ webforai https://spa.example.com -l playwright    render JS in local Chromium
  $ webforai https://example.com --engine auto        hosted platform, renders JS when needed
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
const DASHBOARD_ERRORS = new Set(["invalid_api_key", "payment_required"]);

const platformDashboardUrl = (): string => {
	const configured = program.opts<{ platformUrl?: string }>().platformUrl ?? process.env[PLATFORM_URL_ENV];
	return `${(configured || DEFAULT_BASE_URL).replace(/\/+$/u, "")}/dashboard`;
};

program
	.name("webforai")
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
		"platform engine (auto | fetch | browser | proxy-fetch | proxy-browser); implies -l platform",
	)
	.option("--region <region>", "platform proxy egress region (auto | jp); implies -l platform")
	.option("--screenshot", "platform browser engines: also capture a screenshot (expiring URL)")
	.option("--respect-robots", "platform loader: honor the target site's robots.txt rules (off by default)")
	.option("--api-key <key>", `platform API key (defaults to $${API_KEY_ENV})`)
	.option("--platform-url <url>", `platform base URL (defaults to $${PLATFORM_URL_ENV} or the hosted instance)`)
	.option("-i, --interactive", "guided prompt flow (the pre-v3 default)")
	.option("-d, --debug", "verbose logs on stderr")
	.action(async (source: string | undefined, flags: CliFlags & { interactive?: boolean }) => {
		if (flags.interactive) {
			await interactiveCommand(source, flags);
			return;
		}
		if (!source) {
			program.help({ error: true });
		}
		await runCommand(resolveRunOptions(source, flags));
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
		if (DASHBOARD_ERRORS.has(error.code)) {
			console.error(`hint: manage API keys and credits at ${platformDashboardUrl()}`);
		}
		process.exit(1);
	}
	console.error(error instanceof Error ? `error: ${error.message}` : `error: ${String(error)}`);
	process.exit(1);
};

program.exitOverride();
program.parseAsync().catch(fail);
