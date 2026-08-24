import { intro, log, outro, select, spinner, text } from "@clack/prompts";
import pc from "picocolors";
import packageInfo from "../../../../package.json";
import { REGIONS, REQUESTED_ENGINES } from "../../../platform";
import { API_KEY_ENV } from "../../constants";
import { assertContinue } from "../../helpers/assertContinue";
import { inputOutputPath } from "../../helpers/inputOutputPath";
import { inputSourcePath } from "../../helpers/inputSourcePath";
import { selectExtractMode } from "../../helpers/selectExtractMode";
import { selectLoader } from "../../helpers/selectLoader";
import { isUrl } from "../../utils";
import type { CliFlags, ResolvedRun } from "./options";
import { executeRun, writeOutputFile } from "./run";

const ENGINE_HINTS: Record<(typeof REQUESTED_ENGINES)[number], string> = {
	auto: "Cheapest first, renders when the page needs JavaScript · 1–5 credits",
	fetch: "Plain fetch · 1 credit",
	browser: "Browser rendering, screenshots · 5 credits",
	"proxy-fetch": "Rotating-proxy egress · 2 credits",
	"proxy-browser": "Browser rendering behind the proxy · 5 credits",
};

const promptPlatformOptions = async (flags: CliFlags, env: Record<string, string | undefined>) => {
	const engine =
		flags.engine ??
		(await select({
			message: "Select platform engine:",
			initialValue: "auto",
			options: REQUESTED_ENGINES.map((value) => ({ value: value as string, label: value, hint: ENGINE_HINTS[value] })),
		}));
	assertContinue(engine);

	const region =
		flags.region ??
		(await select({
			message: "Select egress region (proxy engines only):",
			initialValue: "auto",
			options: REGIONS.map((value) => ({ value: value as string, label: value })),
		}));
	assertContinue(region);

	let apiKey = flags.apiKey ?? env[API_KEY_ENV];
	if (!apiKey) {
		const entered = await text({
			message: `Enter your platform API key (or set ${API_KEY_ENV}):`,
			placeholder: "wfa_...",
			validate: (value: string) => (value.trim() === "" ? "An API key is required for the platform loader" : undefined),
		});
		assertContinue(entered);
		apiKey = entered;
	}

	return { engine, region, apiKey };
};

/**
 * The guided flow behind `-i/--interactive` — the pre-v3 default. Prompts only for what the
 * flags did not already provide, then runs the exact same pipeline as the non-interactive
 * path and saves the result to a file.
 */
export const interactiveCommand = async (
	initialSource: string | undefined,
	flags: CliFlags,
	env: Record<string, string | undefined> = process.env,
): Promise<void> => {
	intro(pc.bold(pc.green(`webforai CLI version ${packageInfo.version}`)));

	const source = initialSource ?? (await inputSourcePath());

	const loader = isUrl(source) ? flags.loader ?? (await selectLoader()) : "local";

	const run: ResolvedRun = {
		source,
		loader: loader as ResolvedRun["loader"],
		mode: "default",
		extractor: (flags.extractor as ResolvedRun["extractor"]) ?? "auto",
		frontmatter: flags.frontmatter ?? false,
		json: false,
		debug: flags.debug ?? false,
		screenshot: flags.screenshot ?? false,
	};

	if (loader === "platform") {
		const platform = await promptPlatformOptions(flags, env);
		run.engine = platform.engine as ResolvedRun["engine"];
		run.region = platform.region as ResolvedRun["region"];
		run.apiKey = platform.apiKey;
		run.platformUrl = flags.platformUrl;
	} else {
		run.mode = (flags.mode as ResolvedRun["mode"]) ?? (await selectExtractMode());
	}

	const outputPath = flags.output ?? (await inputOutputPath(source));

	const s = spinner();
	s.start(loader === "platform" ? "Converting via the platform..." : "Loading and converting...");
	let markdown: string;
	try {
		const envelope = await executeRun(run);
		markdown = envelope.markdown;
		s.stop(pc.green("Converted!"));
		if (envelope.credits !== undefined) {
			log.info(`Credits used: ${envelope.credits}`);
		}
		if (envelope.screenshotUrl) {
			log.info(`Screenshot (expires ~24h): ${envelope.screenshotUrl}`);
		}
	} catch (error) {
		s.stop(pc.red("Conversion failed!"));
		throw error;
	}

	await writeOutputFile(outputPath, markdown);
	outro(pc.green(`${pc.bold("Done!")} Markdown saved to ${outputPath}`));
};
