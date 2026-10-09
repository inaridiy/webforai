import fs from "node:fs/promises";
import path from "node:path";
import { PlatformApiError, createPlatformClient, isStoredPageStub } from "webforai/platform";
import type { JobResultItem, JobStatus, PageFailure, PageResult, PageSuccess, PlatformClient } from "webforai/platform";
import { planOutputFiles, resolveInside } from "./files";
import { renderLlmsFullTxt, renderLlmsTxt } from "./llms-txt";
import type { ResolvedJob } from "./options";

const POLL_INTERVAL_MS = 2000;
const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_LISTED_FAILURES = 20;

export interface JobIo {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	/** Live progress (a rewritten status line) only when stderr is an interactive terminal. */
	isTTY: boolean;
	sleep: (ms: number) => Promise<void>;
	fetch: typeof fetch;
}

const defaultIo = (): JobIo => ({
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
	isTTY: Boolean(process.stderr.isTTY),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	fetch: globalThis.fetch.bind(globalThis),
});

/** What `--json` prints: the job, every written file, and every failed page. */
export interface JobEnvelope {
	jobId: string;
	type: ResolvedJob["kind"];
	status: JobStatus["status"];
	outputDir: string;
	credits: number;
	pages: { url: string; file: string; title?: string; engine: string; credits: number; warning?: string }[];
	failures: { url: string; code: string; message: string }[];
	llmsTxt?: string;
	llmsFullTxt?: string;
	error?: string;
}

/** The job finished but not cleanly (job failed, or no page converted) — exit code 1. */
export class JobIncompleteError extends Error {}

const progressLine = (kind: string, status: JobStatus): string => {
	const total = status.total > 0 ? `/${status.total}` : "";
	const failed = status.failed > 0 ? ` · ${status.failed} failed` : "";
	return `${kind} ${status.jobId} · ${status.status} · ${status.completed}${total} pages${failed} · ${status.credits} credits`;
};

/**
 * Retries `rate_limited` (429) responses, honouring `retryAfter` when the server sends one.
 * Other errors — including `too_many_jobs`, which waits on *other* jobs finishing — surface.
 */
const withRateLimitRetry = async <T>(io: JobIo, log: (line: string) => void, call: () => Promise<T>): Promise<T> => {
	for (let attempt = 1; ; attempt++) {
		try {
			return await call();
		} catch (error) {
			if (!(error instanceof PlatformApiError) || error.code !== "rate_limited" || attempt > MAX_RATE_LIMIT_RETRIES) {
				throw error;
			}
			const seconds = Math.min(error.retryAfter ?? 2 ** attempt, 120);
			log(`rate limited; retrying in ${seconds}s`);
			await io.sleep(seconds * 1000);
		}
	}
};

const submit = (client: PlatformClient, job: ResolvedJob) => {
	const common = {
		engine: job.engine,
		region: job.region,
		respectRobotsTxt: job.respectRobotsTxt,
		convert: { extractor: job.extractor, frontmatter: job.frontmatter || undefined },
	};
	if (job.kind === "batch") {
		return client.batch({ urls: job.urls, ...common });
	}
	return client.crawl({
		url: job.urls[0] as string,
		maxDepth: job.maxDepth,
		limit: job.limit,
		includePaths: job.includePaths,
		excludePaths: job.excludePaths,
		sitemap: job.sitemap,
		...common,
	});
};

const resolveItem = async (io: JobIo, item: JobResultItem): Promise<PageResult> => {
	if (!isStoredPageStub(item)) {
		return item;
	}
	// Large results live behind an expiring, unauthenticated URL.
	const response = await io.fetch(item.resultUrl);
	if (!response.ok) {
		throw new PlatformApiError(
			"artifact_fetch_failed",
			`stored result for ${item.url} could not be downloaded (HTTP ${response.status})`,
			response.status,
		);
	}
	return (await response.json()) as PageSuccess;
};

/** stderr logging with an optional live (rewritten) progress line on terminals. */
const createReporter = (io: JobIo, job: ResolvedJob) => {
	let liveLine = false;
	const clearLive = () => {
		if (liveLine) {
			io.stderr("\r\u001b[2K");
			liveLine = false;
		}
	};
	const log = (line: string) => {
		clearLive();
		io.stderr(`[webforai] ${line}\n`);
	};
	const status = (current: JobStatus) => {
		if (io.isTTY) {
			io.stderr(`\r\u001b[2K[webforai] ${progressLine(job.kind, current)}`);
			liveLine = true;
		} else if (job.debug) {
			log(progressLine(job.kind, current));
		}
	};
	return { log, status, clearLive };
};

type Reporter = ReturnType<typeof createReporter>;

const waitWithProgress = async (
	client: PlatformClient,
	job: ResolvedJob,
	jobId: string,
	io: JobIo,
	reporter: Reporter,
): Promise<JobStatus> => {
	const deadline = Date.now() + job.timeoutMs;
	try {
		return await withRateLimitRetry(io, reporter.log, () =>
			client.waitForJob(jobId, {
				pollIntervalMs: POLL_INTERVAL_MS,
				timeoutMs: Math.max(1, deadline - Date.now()),
				onStatus: reporter.status,
			}),
		);
	} catch (error) {
		if (error instanceof PlatformApiError && error.code === "poll_timeout") {
			throw new PlatformApiError(
				"poll_timeout",
				`${error.message}; the job keeps running on the platform and its results stay available for 7 days (GET /v1/jobs/${jobId}/results)`,
				0,
			);
		}
		throw error;
	} finally {
		reporter.clearLive();
	}
};

const collectResults = async (client: PlatformClient, jobId: string, io: JobIo, reporter: Reporter) => {
	const successes: PageSuccess[] = [];
	const failures: PageFailure[] = [];
	let cursor: string | undefined;
	do {
		const page = await withRateLimitRetry(io, reporter.log, () => client.getJobResults(jobId, { cursor }));
		for (const item of page.results) {
			const result = await resolveItem(io, item);
			if (result.status === "ok") {
				successes.push(result);
			} else {
				failures.push(result);
			}
		}
		cursor = page.cursor;
	} while (cursor);
	return { successes, failures };
};

const writePages = async (job: ResolvedJob, successes: PageSuccess[]): Promise<JobEnvelope["pages"]> => {
	const byUrl = new Map(successes.map((page) => [page.url, page]));
	const written: JobEnvelope["pages"] = [];
	await fs.mkdir(job.outputDir, { recursive: true });
	for (const { url, relativePath } of planOutputFiles([...byUrl.keys()], { includeHost: job.kind === "batch" })) {
		const page = byUrl.get(url) as PageSuccess;
		const target = resolveInside(job.outputDir, relativePath);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, page.markdown.endsWith("\n") ? page.markdown : `${page.markdown}\n`);
		written.push({
			url,
			file: path.join(job.outputDir, relativePath),
			title: typeof page.metadata.title === "string" ? page.metadata.title : undefined,
			engine: page.engine,
			credits: page.credits,
			warning: page.warning,
		});
	}
	return written;
};

const writeLlmsFiles = async (job: ResolvedJob, successes: PageSuccess[], envelope: JobEnvelope): Promise<void> => {
	const pages = [...new Map(successes.map((page) => [page.url, page])).values()];
	const site = { seedUrl: job.urls[0] as string, pages };
	envelope.llmsTxt = path.join(job.outputDir, "llms.txt");
	envelope.llmsFullTxt = path.join(job.outputDir, "llms-full.txt");
	await fs.writeFile(envelope.llmsTxt, renderLlmsTxt(site));
	await fs.writeFile(envelope.llmsFullTxt, renderLlmsFullTxt(site));
};

const report = (job: ResolvedJob, envelope: JobEnvelope, io: JobIo, log: (line: string) => void): void => {
	if (job.json) {
		io.stdout(`${JSON.stringify(envelope, null, 2)}\n`);
	} else {
		for (const page of envelope.pages) {
			io.stdout(`${page.file}\n`);
		}
	}

	const failed = envelope.failures.length;
	log(
		`${job.kind} ${envelope.jobId} ${envelope.status}: ${envelope.pages.length} page(s) written to ${job.outputDir}` +
			`${failed > 0 ? `, ${failed} failed` : ""} · ${envelope.credits} credits`,
	);
	if (envelope.llmsTxt) {
		log(`llms.txt and llms-full.txt written to ${job.outputDir}`);
	}
	for (const failure of envelope.failures.slice(0, MAX_LISTED_FAILURES)) {
		log(`  failed ${failure.url} — ${failure.code}: ${failure.message}`);
	}
	if (failed > MAX_LISTED_FAILURES) {
		log(`  … and ${failed - MAX_LISTED_FAILURES} more (see --json)`);
	}
};

/**
 * `webforai crawl` / `webforai batch`: submit the job, wait for it (progress on stderr), page
 * through the results, write one `.md` per page into the output directory (plus llms.txt
 * files on request), then report. stdout carries only the written file paths — or the
 * `--json` envelope — so the command composes like the single-page one.
 */
export const runJobCommand = async (job: ResolvedJob, io: JobIo = defaultIo()): Promise<JobEnvelope> => {
	const client = createPlatformClient({ apiKey: job.apiKey, baseUrl: job.platformUrl, fetch: io.fetch });
	const reporter = createReporter(io, job);

	const { jobId } = await withRateLimitRetry(io, reporter.log, () => submit(client, job));
	reporter.log(
		`${job.kind} job ${jobId} submitted (${job.kind === "crawl" ? job.urls[0] : `${job.urls.length} URLs`})`,
	);

	const final = await waitWithProgress(client, job, jobId, io, reporter);
	const { successes, failures } = await collectResults(client, jobId, io, reporter);

	const envelope: JobEnvelope = {
		jobId,
		type: job.kind,
		status: final.status,
		outputDir: job.outputDir,
		credits: final.credits,
		pages: await writePages(job, successes),
		failures: failures.map(({ url, error }) => ({ url, code: error.code, message: error.message })),
		error: final.error,
	};
	if (job.llmsTxt && successes.length > 0) {
		await writeLlmsFiles(job, successes, envelope);
	}
	report(job, envelope, io, reporter.log);

	if (final.status === "failed") {
		throw new JobIncompleteError(`${job.kind} job ${jobId} failed${final.error ? `: ${final.error}` : ""}`);
	}
	if (envelope.pages.length === 0) {
		throw new JobIncompleteError(`${job.kind} job ${jobId} converted no pages`);
	}
	return envelope;
};
