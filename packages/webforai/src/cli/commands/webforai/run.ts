import fs from "node:fs/promises";
import path from "node:path";
import {
	agentExtractor,
	detectClientShell,
	htmlToMarkdownWithMetadata,
	kiwameExtractor,
	minimalFilter,
	takumiExtractor,
} from "../../../index";
import type { HtmlToMarkdownOptions } from "../../../index";
import { type ExtractorPreset, createPlatformClient } from "../../../platform";
import { isUrl } from "../../utils";
import { loadHtml } from "./loadHtml";
import type { ResolvedRun, RunEnvelope } from "./options";

const debugLog = (enabled: boolean | undefined, message: string): void => {
	if (enabled) {
		console.error(`[webforai] ${message}`);
	}
};

const AI_MODE_OPTIONS = { linkAsText: true, tableAsText: true, hideImage: true } as const;

const extractorOptions = (name: ResolvedRun["extractor"]): HtmlToMarkdownOptions["extractors"] => {
	switch (name) {
		case "takumi":
			return takumiExtractor;
		case "kiwame":
			return kiwameExtractor;
		case "agent":
			return agentExtractor;
		case "minimal":
			return minimalFilter;
		case "none":
			return false;
		default:
			return undefined;
	}
};

const convertViaPlatform = async (run: ResolvedRun): Promise<RunEnvelope> => {
	const platform = createPlatformClient({ apiKey: run.apiKey, baseUrl: run.platformUrl });
	if (run.mode !== "default") {
		console.error("[webforai] --mode is applied by local conversion only and is ignored by the platform loader");
	}
	debugLog(run.debug, `platform scrape: ${run.source} (engine=${run.engine ?? "auto"})`);

	const result = await platform.scrape({
		url: run.source,
		engine: run.engine,
		region: run.region,
		screenshot: run.screenshot ? true : undefined,
		respectRobotsTxt: run.respectRobotsTxt ? true : undefined,
		// `kiwame` is rejected for the platform loader during option resolution.
		convert: { extractor: run.extractor as ExtractorPreset, frontmatter: run.frontmatter },
	});

	return {
		source: run.source,
		loader: "platform",
		url: result.url,
		engine: result.engine,
		region: run.region,
		markdown: result.markdown,
		metadata: result.metadata,
		credits: result.credits,
		screenshotUrl: result.screenshotUrl,
		warning: result.warning,
	};
};

const convertLocally = async (run: ResolvedRun): Promise<RunEnvelope> => {
	const html = await loadHtml(run.source, run.loader, { debug: run.debug });
	const sourceUrl = isUrl(run.source) ? run.source : undefined;

	const { markdown, metadata } = htmlToMarkdownWithMetadata(html, {
		baseUrl: sourceUrl,
		url: sourceUrl,
		frontmatter: run.frontmatter,
		extractors: extractorOptions(run.extractor),
		...(run.mode === "ai" ? AI_MODE_OPTIONS : {}),
	});

	// The plain-fetch loader cannot run JavaScript; when the document is a client-rendered
	// shell, say so instead of silently printing an empty body.
	const shell = run.loader === "fetch" ? detectClientShell(html) : undefined;
	const warning = shell?.isShell
		? "This page looks like it renders client-side; the fetched HTML has no readable content. Try --engine auto (hosted platform, renders JavaScript) or --loader playwright."
		: undefined;

	return {
		source: run.source,
		loader: run.loader,
		url: sourceUrl,
		markdown,
		metadata: metadata as unknown as Record<string, unknown>,
		warning,
	};
};

/** Acquire + convert, without deciding where the result goes. */
export const executeRun = (run: ResolvedRun): Promise<RunEnvelope> =>
	run.loader === "platform" ? convertViaPlatform(run) : convertLocally(run);

export const writeOutputFile = async (outputPath: string, markdown: string): Promise<void> => {
	await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
	await fs.writeFile(outputPath, markdown);
};

/**
 * The non-interactive entry: converts and prints the markdown (or the `--json` envelope) to
 * stdout. Only the conversion result goes to stdout — every log goes to stderr — so the
 * command composes with pipes and is safe for agents to call programmatically.
 */
export const runCommand = async (run: ResolvedRun): Promise<void> => {
	const envelope = await executeRun(run);

	if (run.output) {
		await writeOutputFile(run.output, envelope.markdown);
		envelope.output = run.output;
		console.error(`[webforai] markdown written to ${run.output}`);
	}

	if (run.json) {
		process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
		return;
	}
	if (!run.output) {
		process.stdout.write(envelope.markdown.endsWith("\n") ? envelope.markdown : `${envelope.markdown}\n`);
	}

	if (envelope.warning) {
		console.error(`[webforai] warning: ${envelope.warning}`);
	}
	if (envelope.screenshotUrl) {
		console.error(`[webforai] screenshot (expires ~24h): ${envelope.screenshotUrl}`);
	}
	if (envelope.credits !== undefined) {
		console.error(`[webforai] credits used: ${envelope.credits}`);
	}
};
