import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { createArtifactStore } from "../artifacts/store";
import { type BillingDeps, ensureSpendable } from "../billing/guard";
import { createBillingRepo } from "../billing/repo";
import { createStripe } from "../billing/stripe";
import { recordUsage } from "../billing/usage";
import { type CrawlScope, discoverLinks } from "../core/links";
import { type ScrapeDeps, convertFetchedPage, fetchForScrape } from "../core/scrape-core";
import { PlatformError, type ScrapeRequest } from "../core/types";
import { createDb } from "../db/client";
import { createEngines } from "../engines";
import { loadConfig } from "../env";
import type { BatchRequest, CrawlRequest } from "../routes/schemas";
import { traverseCrawl } from "./crawl-plan";
import { type JobsRepo, createJobsRepo } from "./repo";
import { type JobResultsDeps, type PageResult, createJobResultsDeps, putJobMeta, putPageResult } from "./results";

/**
 * The async job engine.
 *
 * Workflows re-execute `run()` on every wake-up and replay completed steps from their cached
 * return values, so this class obeys two rules:
 *
 * 1. Everything nondeterministic or side-effecting happens inside `step.do`.
 * 2. Steps return only small JSON summaries (Workflows caps a step return at 1 MiB) — the page
 *    result itself is written to KV/R2 *inside* the step.
 *
 * The crawl frontier therefore lives in `run()`-local memory and is rebuilt deterministically
 * from the `links` each page step returns, which is exactly what replay reproduces.
 */

export interface JobParamsBase {
	jobId: string;
	userId: string;
	/** Copied into the job at creation so steps never have to resolve the customer themselves. */
	stripeCustomerId?: string;
}

export type JobParams =
	| (JobParamsBase & { type: "batch"; request: BatchRequest })
	| (JobParamsBase & { type: "crawl"; request: CrawlRequest });

/**
 * Per-page retry policy: transient engine/network failures are worth two more attempts.
 * Durations use the runtime's `<number> <unit>` grammar — "5s" is not a valid delay.
 */
const PAGE_STEP_CONFIG = {
	retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
	timeout: "2 minutes",
} as const;

/** Cap on links returned from a step, so a link farm cannot blow the 1 MiB step-return limit. */
export const MAX_LINKS_PER_PAGE = 200;

/** The one failure that must abort the whole job, carried on both the error's name and message. */
const PAYMENT_REQUIRED = "payment_required";
const PAYMENT_REQUIRED_NAME = "PaymentRequired";

/** What a page step returns. Deliberately tiny — the result itself is already in KV. */
export interface PageOutcome {
	url: string;
	ok: boolean;
	credits: number;
	/** Crawl only; empty for batch pages and for failures. */
	links: string[];
}

/** Everything a page step touches, injected so the step body is testable without Cloudflare. */
export interface JobDeps {
	scrape: ScrapeDeps;
	results: JobResultsDeps;
	jobsRepo: JobsRepo;
	/** Throws `NonRetryableError` when the user cannot spend — see `spendGuard`. */
	guard: (userId: string) => Promise<void>;
	recordPageUsage: (params: { userId: string; jobId: string; credits: number; operation: string }) => Promise<void>;
}

const buildDeps = (env: Env, params: JobParams): JobDeps => {
	const config = loadConfig(env);
	const db = createDb(env);
	const billingRepo = createBillingRepo(db);
	const stripe = createStripe(config);

	return {
		scrape: { engines: createEngines(env, config), artifacts: createArtifactStore(env, config) },
		results: createJobResultsDeps(env, config),
		jobsRepo: createJobsRepo(db),
		guard: (userId) => spendGuard({ repo: billingRepo, config }, userId),
		// No `waitUntil` here: a Workflow step must not outlive itself, so the meter call is
		// awaited and any failure is left to `retryUnreportedUsage`.
		recordPageUsage: async ({ userId, jobId, credits, operation }) => {
			await recordUsage(
				{ repo: billingRepo, config, stripe },
				{ userId, stripeCustomerId: params.stripeCustomerId ?? null, jobId, operation, credits },
			);
		},
	};
};

/** Re-checked before every page: an allowance can run out mid-job. */
export const spendGuard = async (deps: BillingDeps, userId: string): Promise<void> => {
	try {
		await ensureSpendable(deps, userId);
	} catch (error) {
		if (error instanceof PlatformError && error.status === 402) {
			// Retrying cannot make the user solvent; the whole job stops here.
			throw new NonRetryableError(`${PAYMENT_REQUIRED}: ${error.message}`, PAYMENT_REQUIRED_NAME);
		}
		throw error;
	}
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The abort signal has to survive the step boundary, where the runtime rebuilds the error from
 * its name and message — so both are checked rather than the error's class.
 */
const isPaymentRequired = (error: unknown): boolean =>
	(error instanceof Error && error.name === PAYMENT_REQUIRED_NAME) || messageOf(error).startsWith(PAYMENT_REQUIRED);

/**
 * A page failure that no retry can fix: a client-side error (bad URL, unsupported combination)
 * is recorded as a failed page. Everything else is rethrown so Workflows retries the step.
 */
const isTerminalPageError = (error: unknown): boolean =>
	error instanceof PlatformError && error.status >= 400 && error.status < 500;

export interface RunPageParams {
	jobId: string;
	userId: string;
	index: number;
	request: ScrapeRequest;
	/** Present for crawls: link discovery runs on the raw HTML, before extraction. */
	scope?: CrawlScope;
	/** Crawl pages grow the job's total as they are discovered; batch pages know it upfront. */
	countsTowardsTotal: boolean;
}

/**
 * The body of one page step. Exported for the Workflow only — everything it touches is
 * injected, so it is the unit under test rather than the entrypoint class.
 */
export const runPage = async (deps: JobDeps, params: RunPageParams): Promise<PageOutcome> => {
	const { request } = params;
	await deps.guard(params.userId);

	try {
		const page = await fetchForScrape(deps.scrape, request);
		const links = params.scope ? discoverLinks(page.html, page.url, params.scope).slice(0, MAX_LINKS_PER_PAGE) : [];
		const result = await convertFetchedPage(deps.scrape, request, page);

		await putPageResult(deps.results, params.jobId, params.index, { status: "ok", ...result });
		await deps.jobsRepo.incrementCounters(params.jobId, {
			succeeded: 1,
			creditsUsed: result.credits,
			...(params.countsTowardsTotal ? { total: 1 } : {}),
		});
		// Last, so a retry of anything before it cannot double-bill: `recordUsage` only throws
		// when the ledger insert itself failed, which is precisely when it must be retried.
		await deps.recordPageUsage({
			userId: params.userId,
			jobId: params.jobId,
			credits: result.credits,
			operation: request.engine,
		});

		return { url: result.url, ok: true, credits: result.credits, links };
	} catch (error) {
		if (!isTerminalPageError(error)) {
			throw error;
		}
		await recordPageFailure(deps, params, error);
		return { url: request.url, ok: false, credits: 0, links: [] };
	}
};

/** Persists a failed page and its counter. Never bills — a failed page is not a product. */
const recordPageFailure = async (deps: JobDeps, params: RunPageParams, error: unknown): Promise<void> => {
	const failure: PageResult = {
		status: "error",
		url: params.request.url,
		engine: params.request.engine,
		error: {
			code: error instanceof PlatformError ? error.code : "page_failed",
			message: messageOf(error),
		},
	};
	await putPageResult(deps.results, params.jobId, params.index, failure);
	await deps.jobsRepo.incrementCounters(params.jobId, {
		failed: 1,
		...(params.countsTowardsTotal ? { total: 1 } : {}),
	});
};

/** The per-page `ScrapeRequest` a job's stored request expands to for one URL. */
const scrapeRequestFor = (params: JobParams, url: string): ScrapeRequest => ({
	url,
	engine: params.request.engine,
	screenshot: params.request.screenshot,
	rehostImages: params.request.rehostImages,
	convert: params.request.convert,
});

export class CrawlWorkflow extends WorkflowEntrypoint<Env, JobParams> {
	async run(event: Readonly<WorkflowEvent<JobParams>>, step: WorkflowStep): Promise<void> {
		const params = event.payload;
		const deps = buildDeps(this.env, params);

		await step.do("start", () => markRunning(deps, params));

		const summary = params.type === "batch" ? await runBatch(deps, step, params) : await runCrawl(deps, step, params);

		await step.do("finalize", () => finalize(deps, params, summary));
	}
}

interface JobSummary {
	succeeded: number;
	failed: number;
	credits: number;
	/** Set when the job aborted; the job ends `failed` with this code. */
	error?: string;
}

const markRunning = async (deps: JobDeps, params: JobParams): Promise<{ jobId: string }> => {
	await deps.jobsRepo.updateStatus(params.jobId, "running");
	return { jobId: params.jobId };
};

const runBatch = async (
	deps: JobDeps,
	step: WorkflowStep,
	params: JobParams & { type: "batch" },
): Promise<JobSummary> => {
	const summary: JobSummary = { succeeded: 0, failed: 0, credits: 0 };

	for (const [index, url] of params.request.urls.entries()) {
		const outcome = await runPageStep(deps, step, {
			jobId: params.jobId,
			userId: params.userId,
			index,
			request: scrapeRequestFor(params, url),
			countsTowardsTotal: false,
		});
		if (outcome === undefined) {
			return { ...summary, error: PAYMENT_REQUIRED };
		}
		applyOutcome(summary, outcome);
	}

	return summary;
};

const runCrawl = async (
	deps: JobDeps,
	step: WorkflowStep,
	params: JobParams & { type: "crawl" },
): Promise<JobSummary> => {
	const { request } = params;
	const summary: JobSummary = { succeeded: 0, failed: 0, credits: 0 };
	const scope: CrawlScope = {
		origin: new URL(request.url).origin,
		...(request.includePaths ? { includePaths: request.includePaths } : {}),
		...(request.excludePaths ? { excludePaths: request.excludePaths } : {}),
	};
	const traversal = await traverseCrawl(
		new URL(request.url).href,
		{ maxDepth: request.maxDepth, limit: request.limit },
		async ({ url, index }) => {
			const outcome = await runPageStep(deps, step, {
				jobId: params.jobId,
				userId: params.userId,
				index,
				request: scrapeRequestFor(params, url),
				scope,
				countsTowardsTotal: true,
			});
			if (outcome === undefined) {
				return undefined;
			}
			applyOutcome(summary, outcome);
			return { links: outcome.links };
		},
	);

	return traversal.aborted ? { ...summary, error: PAYMENT_REQUIRED } : summary;
};

const applyOutcome = (summary: JobSummary, outcome: PageOutcome): void => {
	if (outcome.ok) {
		summary.succeeded += 1;
		summary.credits += outcome.credits;
	} else {
		summary.failed += 1;
	}
};

/**
 * Runs one page as a Workflow step.
 *
 * Returns `undefined` when the job must abort (payment required). A step that exhausted its
 * retries is recorded as a failed page by a second, tiny step — recording it outside a step
 * would be a side effect that replay could not reproduce.
 */
const runPageStep = async (
	deps: JobDeps,
	step: WorkflowStep,
	pageParams: RunPageParams,
): Promise<PageOutcome | undefined> => {
	const name = `page ${pageParams.index}: ${pageParams.request.url}`;
	try {
		return await step.do(name, PAGE_STEP_CONFIG, () => runPage(deps, pageParams));
	} catch (error) {
		if (isPaymentRequired(error)) {
			return undefined;
		}
		const message = messageOf(error);
		await step.do(`${name} (failed)`, async () => {
			await recordPageFailure(deps, pageParams, new PlatformError("page_failed", message, 502));
			return { recorded: true };
		});
		return { url: pageParams.request.url, ok: false, credits: 0, links: [] };
	}
};

/**
 * The KV snapshot is written *before* the terminal D1 status on purpose: results and snapshot
 * share a TTL and are written by this same step, so a client that sees a terminal job in D1 is
 * guaranteed to find a matching snapshot. It also means the snapshot can be ahead of D1 when the
 * D1 write is the thing that failed — which is why `GET /v1/jobs/:id` prefers a terminal snapshot.
 */
const finalize = async (deps: JobDeps, params: JobParams, summary: JobSummary): Promise<{ status: string }> => {
	const status = summary.error ? "failed" : "completed";
	await putJobMeta(deps.results, {
		jobId: params.jobId,
		type: params.type,
		status,
		total: summary.succeeded + summary.failed,
		completed: summary.succeeded,
		failed: summary.failed,
		credits: summary.credits,
		error: summary.error ?? null,
		updatedAt: new Date().toISOString(),
	});
	await deps.jobsRepo.updateStatus(params.jobId, status, { error: summary.error ?? null });
	return { status };
};
