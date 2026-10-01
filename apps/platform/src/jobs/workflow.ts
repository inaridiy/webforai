import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { eq } from "drizzle-orm";
import { createArtifactStore } from "../artifacts/store";
import { type BillingDeps, ensureSpendable, usesProxyTier } from "../billing/guard";
import { createBillingRepo } from "../billing/repo";
import { createStripe } from "../billing/stripe";
import { reportToStripe } from "../billing/usage";
import type { CrawlScope } from "../core/links";
import { PlatformError, type ScrapeRequest } from "../core/types";
import { createDb } from "../db/client";
import { usageEvents } from "../db/schema";
import { createEngines } from "../engines";
import { loadConfig } from "../env";
import type { BatchRequest, CrawlRequest } from "../routes/schemas";
import { traverseCrawl } from "./crawl-plan";
import { type PageDeps, type PageOutcome, type RunPageParams, recordPageFailure, runPage } from "./page";
import { createPageAccountingRepo } from "./page-accounting";
import { createPageArchiveStore } from "./page-archive";
import { type JobsRepo, createJobsRepo } from "./repo";
import { createJobResultsDeps, putJobMeta } from "./results";

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

/**
 * The failures that must abort the whole job (any 402: no allowance, proxy tier without a
 * subscription, spend cap reached), carried on both the error's name and message. The message
 * starts with the PlatformError code, which becomes the job's `error`.
 */
const PAYMENT_REQUIRED = "payment_required";
const PAYMENT_REQUIRED_NAME = "PaymentRequired";
const ABORT_CODES = [PAYMENT_REQUIRED, "spend_cap_reached"] as const;

interface JobDeps extends PageDeps {
	jobsRepo: JobsRepo;
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
		guard: (userId) => spendGuard({ repo: billingRepo, config }, userId, { proxy: usesProxyTier(params.request) }),
		accounting: createPageAccountingRepo(db),
		archives: createPageArchiveStore(env.ARTIFACTS),
		now: () => new Date(),
		reportUsage: async (page) => {
			if (!(config.billingEnabled && stripe && params.stripeCustomerId)) return;
			const [usage] = await db.select().from(usageEvents).where(eq(usageEvents.id, page.id)).limit(1);
			if (!usage || usage.reportedAt) return;
			await reportToStripe(
				{ repo: billingRepo, config, stripe },
				{
					id: page.id,
					stripeCustomerId: params.stripeCustomerId,
					credits: usage.credits,
					createdAt: usage.createdAt,
				},
			);
		},
	};
};

/** Re-checked before every page: an allowance, a subscription or the spend cap can run out mid-job. */
export const spendGuard = async (
	deps: BillingDeps,
	userId: string,
	options: { proxy?: boolean } = {},
): Promise<void> => {
	try {
		await ensureSpendable(deps, userId, options);
	} catch (error) {
		if (error instanceof PlatformError && error.status === 402) {
			// Retrying cannot make the user solvent; the whole job stops here.
			const code = error.code === "spend_cap_reached" ? error.code : PAYMENT_REQUIRED;
			throw new NonRetryableError(`${code}: ${error.message}`, PAYMENT_REQUIRED_NAME);
		}
		throw error;
	}
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The abort signal has to survive the step boundary, where the runtime rebuilds the error from
 * its name and message — so both are checked rather than the error's class.
 */
export const abortCodeOf = (error: unknown): string | undefined => {
	const message = messageOf(error);
	const code = ABORT_CODES.find((candidate) => message.startsWith(candidate));
	if (code) return code;
	return error instanceof Error && error.name === PAYMENT_REQUIRED_NAME ? PAYMENT_REQUIRED : undefined;
};

/** The per-page `ScrapeRequest` a job's stored request expands to for one URL. */
const scrapeRequestFor = (params: JobParams, url: string): ScrapeRequest => ({
	url,
	engine: params.request.engine,
	screenshot: params.request.screenshot,
	rehostImages: params.request.rehostImages,
	region: params.request.region,
	respectRobotsTxt: params.request.respectRobotsTxt ?? false,
	convert: params.request.convert,
});

export class CrawlWorkflow extends WorkflowEntrypoint<Env, JobParams> {
	async run(event: Readonly<WorkflowEvent<JobParams>>, step: WorkflowStep): Promise<void> {
		const params = event.payload;
		const deps = buildDeps(this.env, params);

		try {
			await step.do("start", () => markRunning(deps, params));
			const summary = params.type === "batch" ? await runBatch(deps, step, params) : await runCrawl(deps, step, params);
			await step.do("finalize", () => finalize(deps, params, summary));
		} catch (error) {
			// Publication/storage failures can exhaust both the page step and its recovery
			// step. Expose that terminal failure instead of leaving D1 running forever.
			await step.do("workflow failed", async () => {
				console.error("job_workflow_failed", { jobId: params.jobId, error });
				await deps.jobsRepo.updateStatus(params.jobId, "failed", {
					error: "The job could not finish. Please retry later.",
				});
			});
			throw error;
		}
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
	await deps.jobsRepo.updateStatus(params.jobId, "running", { error: null });
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
		if ("abort" in outcome) {
			return { ...summary, error: outcome.abort };
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
	let abort: string = PAYMENT_REQUIRED;
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
			if ("abort" in outcome) {
				abort = outcome.abort;
				return undefined;
			}
			applyOutcome(summary, outcome);
			return { links: outcome.links };
		},
	);

	return traversal.aborted ? { ...summary, error: abort } : summary;
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
 * Returns `{ abort: code }` when the job must abort (a 402 from the spend guard). A step that exhausted its
 * retries is recorded as a failed page by a second, tiny step — recording it outside a step
 * would be a side effect that replay could not reproduce.
 */
const runPageStep = async (
	deps: JobDeps,
	step: WorkflowStep,
	pageParams: RunPageParams,
): Promise<PageOutcome | { abort: string }> => {
	const name = `page ${pageParams.index}: ${pageParams.request.url}`;
	try {
		return await step.do(name, PAGE_STEP_CONFIG, () => runPage(deps, pageParams));
	} catch (error) {
		const abort = abortCodeOf(error);
		if (abort) {
			return { abort };
		}
		return step.do(`${name} (failed)`, () => recordPageFailure(deps, pageParams, error));
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
