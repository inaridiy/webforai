import { Hono } from "hono";

import type { AuthVariables } from "../auth/middleware";
import { ensureSpendable } from "../billing/guard";
import { PlatformError, type ScrapeRequest } from "../core/types";
import { ulid } from "../core/ulid";
import { createDb } from "../db/client";
import { loadConfig } from "../env";
import { listCanonicalPageResults } from "../jobs/canonical-results";
import { createPageAccountingRepo } from "../jobs/page-accounting";
import { createPageArchiveStore } from "../jobs/page-archive";
import { type JobRow, createJobsRepo } from "../jobs/repo";
import {
	DEFAULT_RESULTS_PAGE_SIZE,
	JOB_RESULT_TTL_SECONDS,
	createJobResultsDeps,
	getJobMeta,
	listPageResults,
} from "../jobs/results";
import { startJob as scheduleJob } from "../jobs/start";
import type { JobParams } from "../jobs/workflow";
import { onPlatformError } from "./errors";
import {
	type BatchRequest,
	type CrawlRequest,
	type ScrapeBody,
	batchBodySchema,
	crawlBodySchema,
	scrapeBodySchema,
} from "./schemas";
import { parseScrapeBody } from "./scrape-body";
import { billingDeps, customerIdOf, runSyncScrape } from "./scrape-run";

/**
 * The public, API-key authenticated surface (docs/specs/platform/03_api.md).
 *
 * Two rules shape every handler here:
 * - the spend guard runs **before** any side effect, and
 * - usage is recorded **after** success only, so a failed operation is never billed.
 */

type V1Env = { Bindings: Env; Variables: AuthVariables };

export { batchBodySchema, crawlBodySchema, scrapeBodySchema };

const jobResponse = (
	row: JobRow,
	status: JobRow["status"],
	counts: Pick<JobRow, "total" | "succeeded" | "failed">,
) => ({
	jobId: row.id,
	type: row.type,
	status,
	total: counts.total,
	completed: counts.succeeded,
	failed: counts.failed,
	credits: row.creditsUsed,
	expiresAt: new Date(row.createdAt.getTime() + JOB_RESULT_TTL_SECONDS * 1000).toISOString(),
	...(row.error ? { error: row.error } : {}),
});

const TERMINAL: JobRow["status"][] = ["completed", "failed"];

export const v1Routes = () => {
	const app = new Hono<V1Env>();
	app.onError(onPlatformError);

	/** Creates the D1 row first, then the Workflow instance: a job that exists is always visible. */
	const startJob = async (
		env: Env,
		params: { userId: string; total: number } & (
			| { type: "batch"; request: BatchRequest }
			| {
					type: "crawl";
					request: CrawlRequest;
			  }
		),
	): Promise<string> => {
		const jobId = `job_${ulid()}`;
		const jobsRepo = createJobsRepo(createDb(env));
		const stripeCustomerId = await customerIdOf(env, params.userId);

		const identity = { jobId, userId: params.userId, ...(stripeCustomerId ? { stripeCustomerId } : {}) };
		const jobParams: JobParams =
			params.type === "batch"
				? { ...identity, type: "batch", request: params.request }
				: { ...identity, type: "crawl", request: params.request };

		return scheduleJob(
			{
				jobs: jobsRepo,
				schedule: (id, job) => env.CRAWL_WORKFLOW.create({ id, params: job }),
				confirmScheduled: async (id) => (await env.CRAWL_WORKFLOW.get(id)).status(),
			},
			jobParams,
			params.total,
		);
	};

	app.post("/scrape", async (c) => {
		const body: ScrapeBody = await parseScrapeBody(c.req.json(), scrapeBodySchema);
		const userId = c.get("apiKeyUserId");
		const config = loadConfig(c.env);

		// Guard first — for both the sync path and the 1-URL job the async flag creates.
		await ensureSpendable(billingDeps(c.env, config), userId);

		if (body.async) {
			const request: BatchRequest = {
				urls: [body.url],
				engine: body.engine,
				screenshot: body.screenshot,
				rehostImages: body.rehostImages,
				region: body.region,
				convert: body.convert,
			};
			const jobId = await startJob(c.env, { userId, type: "batch", request, total: 1 });
			return c.json({ jobId }, 202);
		}

		const request: ScrapeRequest = {
			url: body.url,
			engine: body.engine,
			screenshot: body.screenshot,
			rehostImages: body.rehostImages,
			region: body.region,
			convert: body.convert,
		};
		const result = await runSyncScrape(c, config, { userId, request });

		return c.json(result);
	});

	app.post("/batch", async (c) => {
		const body = await parseScrapeBody(c.req.json(), batchBodySchema);
		const userId = c.get("apiKeyUserId");
		await ensureSpendable(billingDeps(c.env, loadConfig(c.env)), userId);

		const jobId = await startJob(c.env, { userId, type: "batch", request: body, total: body.urls.length });
		return c.json({ jobId }, 202);
	});

	app.post("/crawl", async (c) => {
		const body = await parseScrapeBody(c.req.json(), crawlBodySchema);
		const userId = c.get("apiKeyUserId");
		await ensureSpendable(billingDeps(c.env, loadConfig(c.env)), userId);

		// A crawl discovers its pages as it runs, so `total` starts at zero and grows per page.
		const jobId = await startJob(c.env, { userId, type: "crawl", request: body, total: 0 });
		return c.json({ jobId }, 202);
	});

	app.get("/jobs/:id", async (c) => {
		const config = loadConfig(c.env);
		const row = await requireJob(c.env, c.req.param("id"), c.get("apiKeyUserId"));

		// The Workflow writes its KV snapshot before flipping D1 to a terminal status, so a
		// terminal snapshot on a still-running row means the D1 write is what went missing.
		if (!TERMINAL.includes(row.status)) {
			const meta = await getJobMeta(createJobResultsDeps(c.env, config), row.id);
			if (meta && TERMINAL.includes(meta.status)) {
				return c.json(
					jobResponse(row, meta.status, { total: meta.total, succeeded: meta.completed, failed: meta.failed }),
				);
			}
		}

		return c.json(jobResponse(row, row.status, row));
	});

	app.get("/jobs/:id/results", async (c) => {
		const config = loadConfig(c.env);
		const row = await requireJob(c.env, c.req.param("id"), c.get("apiKeyUserId"));
		const cursor = c.req.query("cursor");

		const resultsDeps = createJobResultsDeps(c.env, config);
		const canonical = await listCanonicalPageResults(
			{
				accounting: createPageAccountingRepo(createDb(c.env)),
				archives: createPageArchiveStore(c.env.ARTIFACTS),
				artifacts: resultsDeps.artifacts,
			},
			row.id,
			cursor,
			new Date(),
		);
		const page = canonical ?? (await listPageResults(resultsDeps, row.id, cursor, DEFAULT_RESULTS_PAGE_SIZE));

		return c.json({
			jobId: row.id,
			status: row.status,
			results: page.results,
			...(page.cursor ? { cursor: page.cursor } : {}),
		});
	});

	return app;
};

/** A job belonging to someone else must be indistinguishable from one that does not exist. */
const requireJob = async (env: Env, id: string, userId: string): Promise<JobRow> => {
	const row = await createJobsRepo(createDb(env)).getJob(id, userId);
	if (!row) {
		throw new PlatformError("job_not_found", `No job ${id}.`, 404);
	}
	return row;
};
