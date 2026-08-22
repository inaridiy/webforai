import fs from "node:fs";
import { ENGINES, REGIONS } from "../../../platform";
import { API_KEY_ENV, EXTRACTORS, LOADERS, MODES, PLATFORM_URL_ENV } from "../../constants";
import type { ExtractorName, Loader, Mode } from "../../constants";
import { isUrl } from "../../utils";

/** A caller mistake (bad flag value, missing input) — reported without a stack, exit code 2. */
export class UsageError extends Error {}

export interface CliFlags {
	output?: string;
	loader?: string;
	mode?: string;
	extractor?: string;
	frontmatter?: boolean;
	json?: boolean;
	engine?: string;
	region?: string;
	screenshot?: boolean;
	apiKey?: string;
	platformUrl?: string;
	debug?: boolean;
}

export interface ResolvedRun {
	source: string;
	loader: Loader;
	mode: Mode;
	extractor: ExtractorName;
	frontmatter: boolean;
	output?: string;
	json: boolean;
	debug: boolean;
	/** Platform-loader fields; undefined otherwise. */
	engine?: (typeof ENGINES)[number];
	region?: (typeof REGIONS)[number];
	screenshot: boolean;
	apiKey?: string;
	platformUrl?: string;
}

const oneOf = <T extends string>(name: string, value: string, allowed: readonly T[]): T => {
	if (!(allowed as readonly string[]).includes(value)) {
		throw new UsageError(`invalid --${name} "${value}" (expected: ${allowed.join(" | ")})`);
	}
	return value as T;
};

/** `--engine`/`--region` only exist on the platform, so they imply the platform loader. */
const impliesPlatform = (flags: CliFlags): boolean => flags.engine !== undefined || flags.region !== undefined;

const resolveLoader = (sourceIsUrl: boolean, flags: CliFlags): Loader => {
	if (flags.loader) {
		return oneOf("loader", flags.loader, LOADERS);
	}
	if (impliesPlatform(flags)) {
		return "platform";
	}
	return sourceIsUrl ? "fetch" : "local";
};

const assertUsableLocalSource = (source: string, loader: Loader, flags: CliFlags): void => {
	if (loader !== "local" && flags.loader) {
		throw new UsageError(`--loader ${loader} needs a URL source, but "${source}" is a local path`);
	}
	if (impliesPlatform(flags)) {
		throw new UsageError("--engine/--region need a URL source (the platform cannot read local files)");
	}
	if (!fs.existsSync(source)) {
		throw new UsageError(`source not found: "${source}" (URLs must start with http:// or https://)`);
	}
};

const applyPlatformFields = (resolved: ResolvedRun, flags: CliFlags, env: Record<string, string | undefined>): void => {
	resolved.engine = flags.engine ? oneOf("engine", flags.engine, ENGINES) : undefined;
	resolved.region = flags.region ? oneOf("region", flags.region, REGIONS) : undefined;
	resolved.apiKey = flags.apiKey ?? env[API_KEY_ENV];
	resolved.platformUrl = flags.platformUrl ?? env[PLATFORM_URL_ENV];
	if (!resolved.apiKey) {
		throw new UsageError(
			`the platform loader needs an API key: pass --api-key or set ${API_KEY_ENV} (create one at https://platform.webforai.dev/dashboard)`,
		);
	}
};

/**
 * Turns raw commander flags into a validated run description. Pure aside from one existence
 * check on local files, so the flag surface is unit-testable without spawning the binary.
 */
export const resolveRunOptions = (
	source: string,
	flags: CliFlags,
	env: Record<string, string | undefined> = process.env,
): ResolvedRun => {
	const sourceIsUrl = isUrl(source);
	const loader = resolveLoader(sourceIsUrl, flags);

	if (!sourceIsUrl) {
		assertUsableLocalSource(source, loader, flags);
	}

	const resolved: ResolvedRun = {
		source,
		loader: sourceIsUrl ? loader : "local",
		mode: flags.mode ? oneOf("mode", flags.mode, MODES) : "default",
		extractor: flags.extractor ? oneOf("extractor", flags.extractor, EXTRACTORS) : "auto",
		frontmatter: flags.frontmatter ?? false,
		output: flags.output,
		json: flags.json ?? false,
		debug: flags.debug ?? false,
		screenshot: flags.screenshot ?? false,
	};

	if (resolved.loader === "platform") {
		applyPlatformFields(resolved, flags, env);
	} else if (flags.screenshot) {
		throw new UsageError("--screenshot is only available with the platform loader (browser engines)");
	}

	return resolved;
};

/** What `--json` prints: everything an agent needs to consume the conversion programmatically. */
export interface RunEnvelope {
	source: string;
	loader: Loader;
	/** Final URL for URL sources (after redirects when the platform reports one). */
	url?: string;
	engine?: string;
	region?: string;
	markdown: string;
	metadata: Record<string, unknown>;
	credits?: number;
	screenshotUrl?: string;
	/** Present when the markdown was also written to a file. */
	output?: string;
}
