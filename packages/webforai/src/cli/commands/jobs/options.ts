import fs from "node:fs";
import { CRAWL_SITEMAP_MODES, REGIONS, REQUESTED_ENGINES } from "../../../platform";
import type { CrawlSitemapMode, Region, RequestedEngine } from "../../../platform";
import { API_KEY_ENV, EXTRACTORS, type ExtractorName, PLATFORM_URL_ENV } from "../../constants";
import { UsageError, missingApiKeyError } from "../webforai/options";

/** Server-side caps (docs/specs/platform/03_api.md); checked locally to fail before billing. */
export const MAX_BATCH_URLS = 100;
export const MAX_CRAWL_DEPTH = 5;
export const MAX_CRAWL_LIMIT = 500;
const DEFAULT_TIMEOUT_SECONDS = 30 * 60;

export type JobKind = "crawl" | "batch";

export interface JobFlags {
	output?: string;
	engine?: string;
	region?: string;
	extractor?: string;
	frontmatter?: boolean;
	/** `true`/`false` from `--respect-robots`/`--no-respect-robots`; undefined = server default. */
	respectRobots?: boolean;
	apiKey?: string;
	platformUrl?: string;
	json?: boolean;
	debug?: boolean;
	/** Seconds to wait for the job before giving up (it keeps running server-side). */
	timeout?: string;
	// crawl
	maxDepth?: string;
	limit?: string;
	include?: string[];
	exclude?: string[];
	sitemap?: string;
	llmsTxt?: boolean;
	// batch
	file?: string;
}

export interface ResolvedJob {
	kind: JobKind;
	/** crawl: exactly one seed URL; batch: 1–100 URLs, de-duplicated, in input order. */
	urls: string[];
	outputDir: string;
	engine?: RequestedEngine;
	region?: Region;
	extractor: ExtractorName;
	frontmatter: boolean;
	respectRobotsTxt?: boolean;
	apiKey: string;
	platformUrl?: string;
	json: boolean;
	debug: boolean;
	timeoutMs: number;
	maxDepth?: number;
	limit?: number;
	includePaths?: string[];
	excludePaths?: string[];
	sitemap?: CrawlSitemapMode;
	llmsTxt: boolean;
}

const isHttpUrl = (value: string): boolean => {
	try {
		const { protocol } = new URL(value);
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
};

const oneOf = <T extends string>(name: string, value: string, allowed: readonly T[]): T => {
	if (!(allowed as readonly string[]).includes(value)) {
		throw new UsageError(`invalid --${name} "${value}" (expected: ${allowed.join(" | ")})`);
	}
	return value as T;
};

const integerIn = (name: string, value: string | undefined, min: number, max: number): number | undefined => {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
		throw new UsageError(`invalid --${name} "${value}" (expected an integer from ${min} to ${max})`);
	}
	return parsed;
};

const patterns = (name: string, values: string[] | undefined): string[] | undefined => {
	if (!values || values.length === 0) {
		return undefined;
	}
	for (const value of values) {
		try {
			new RegExp(value);
		} catch {
			throw new UsageError(`invalid --${name} pattern "${value}" (expected a regular expression)`);
		}
	}
	return values;
};

/** Reads a URL list: one per line, blank lines and `#` comments ignored; `-` is stdin. */
export const parseUrlList = (text: string): string[] =>
	text
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"));

const readUrlFile = (file: string, readFile: (file: string) => string): string[] => {
	try {
		return parseUrlList(readFile(file));
	} catch (error) {
		throw new UsageError(`cannot read --file "${file}": ${error instanceof Error ? error.message : String(error)}`);
	}
};

const defaultReadFile = (file: string): string => fs.readFileSync(file === "-" ? 0 : file, "utf-8");

/**
 * Turns `crawl`/`batch` arguments and flags into a validated job description. Pure except
 * for reading `--file`, so the surface is unit-testable without a server.
 */
export const resolveJobOptions = (
	kind: JobKind,
	sources: string[],
	flags: JobFlags,
	env: Record<string, string | undefined> = process.env,
	readFile: (file: string) => string = defaultReadFile,
): ResolvedJob => {
	const fromFile = kind === "batch" && flags.file ? readUrlFile(flags.file, readFile) : [];
	const urls = [...new Set([...sources, ...fromFile])];

	if (kind === "crawl" && urls.length !== 1) {
		throw new UsageError("crawl takes exactly one seed URL");
	}
	if (urls.length === 0) {
		throw new UsageError("batch needs at least one URL (as arguments or via --file <path|->)");
	}
	if (urls.length > MAX_BATCH_URLS) {
		throw new UsageError(
			`batch takes at most ${MAX_BATCH_URLS} URLs per job (received ${urls.length}); split the list`,
		);
	}
	const invalid = urls.find((url) => !isHttpUrl(url));
	if (invalid !== undefined) {
		throw new UsageError(`not an http(s) URL: "${invalid}"`);
	}
	if (!flags.output) {
		throw new UsageError(`${kind} writes one Markdown file per page: pass -o, --output <dir>`);
	}

	const apiKey = flags.apiKey ?? env[API_KEY_ENV];
	const platformUrl = flags.platformUrl ?? env[PLATFORM_URL_ENV];
	if (!apiKey) {
		throw missingApiKeyError(platformUrl);
	}

	const timeoutSeconds = integerIn("timeout", flags.timeout, 1, 24 * 60 * 60) ?? DEFAULT_TIMEOUT_SECONDS;

	return {
		kind,
		urls,
		outputDir: flags.output,
		engine: flags.engine ? oneOf("engine", flags.engine, REQUESTED_ENGINES) : undefined,
		region: flags.region ? oneOf("region", flags.region, REGIONS) : undefined,
		extractor: flags.extractor ? oneOf("extractor", flags.extractor, EXTRACTORS) : "auto",
		frontmatter: flags.frontmatter ?? false,
		respectRobotsTxt: flags.respectRobots,
		apiKey,
		platformUrl,
		json: flags.json ?? false,
		debug: flags.debug ?? false,
		timeoutMs: timeoutSeconds * 1000,
		maxDepth: integerIn("max-depth", flags.maxDepth, 0, MAX_CRAWL_DEPTH),
		limit: integerIn("limit", flags.limit, 1, MAX_CRAWL_LIMIT),
		includePaths: patterns("include", flags.include),
		excludePaths: patterns("exclude", flags.exclude),
		sitemap: flags.sitemap ? oneOf("sitemap", flags.sitemap, CRAWL_SITEMAP_MODES) : undefined,
		llmsTxt: flags.llmsTxt ?? false,
	};
};
