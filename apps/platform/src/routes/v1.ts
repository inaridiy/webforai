import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { ZodError } from "zod";

import { createArtifactStore } from "../artifacts/store";
import type { AuthVariables } from "../auth/middleware";
import { ensureSpendable } from "../billing/guard";
import { createBillingRepo } from "../billing/repo";
import { createStripe } from "../billing/stripe";
import { recordUsage } from "../billing/usage";
import { scrapePage } from "../core/scrape-core";
import { PlatformError, type ScrapeRequest } from "../core/types";
import { ulid } from "../core/ulid";
import { createDb } from "../db/client";
import { user } from "../db/schema";
import { createEngines } from "../engines";
import { type AppConfig, loadConfig } from "../env";
import { type JobRow, createJobsRepo } from "../jobs/repo";
import {
	DEFAULT_RESULTS_PAGE_SIZE,
	JOB_RESULT_TTL_SECONDS,
	createJobResultsDeps,
	getJobMeta,
	listPageResults,
} from "../jobs/results";
import type { JobParams } from "../jobs/workflow";
import { describeZodError, onPlatformError } from "./errors";
import {
	type BatchRequest,
	type CrawlRequest,
	type ScrapeBody,
	batchBodySchema,
	crawlBodySchema,
	scrapeBodySchema,
} from "./schemas";

/**
 * The public, API-key authenticated surface (docs/specs/platform/03_api.md).
 *
 * Two rules shape every handler here:
 * - the spend guard runs **before** any side effect, and
 * - usage is recorded **after** success only, so a failed operation is never billed.
 */

type V1Env = { Bindings: Env; Variables: AuthVariables };

export { batchBodySchema, crawlBodySchema, scrapeBodySchema };

interface Validator<T> {
	safeParse(value: unknown): { success: true; data: T } | { success: false; error: ZodError };
}

/** Validation failures are 400 `invalid_request`; everything else would let a bad body run a job. */
const parseBody = async <T>(raw: Promise<unknown>, schema: Validator<T>): Promise<T> => {
	let value: unknown;
	try {
		value = await raw;
	} catch {
		throw new PlatformError("invalid_request", "Request body must be valid JSON.", 400);
	}
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		throw new PlatformError("invalid_request", describeZodError(parsed.error), 400);
	}
	return parsed.data;
};

/** The Stripe customer of the *authenticated* user; a client-supplied id is never trusted. */
const customerIdOf = async (env: Env, userId: string): Promise<string | undefined> => {
	const rows = await createDb(env)
		.select({ stripeCustomerId: user.stripeCustomerId })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return rows[0]?.stripeCustomerId ?? undefined;
};

const billingDeps = (env: Env, config: AppConfig) => ({ repo: createBillingRepo(createDb(env)), config });

const scrapeDeps = (env: Env, config: AppConfig) => ({
	engines: createEngines(env, config),
	artifacts: createArtifactStore(env, config),
});

/** `executionCtx` is unavailable outside a real fetch invocation; then the meter call is awaited. */
const waitUntilOf = (c: {
	executionCtx: { waitUntil(promise: Promise<unknown>): void };
}): ((promise: Promise<unknown>) => void) | undefined => {
	try {
		const ctx = c.executionCtx;
		return (promise) => ctx.waitUntil(promise);
	} catch {
		return undefined;
	}
};

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

		await jobsRepo.createJob({
			id: jobId,
			userId: params.userId,
			type: params.type,
			request: params.request,
			total: params.total,
		});

		const identity = { jobId, userId: params.userId, ...(stripeCustomerId ? { stripeCustomerId } : {}) };
		const jobParams: JobParams =
			params.type === "batch"
				? { ...identity, type: "batch", request: params.request }
				: { ...identity, type: "crawl", request: params.request };

		try {
			const instance = await env.CRAWL_WORKFLOW.create({ id: jobId, params: jobParams });
			await jobsRepo.updateStatus(jobId, "queued", { workflowInstanceId: instance.id });
		} catch (error) {
			// The row must not linger as `queued` for a job nothing will ever run.
			await jobsRepo.updateStatus(jobId, "failed", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw new PlatformError("job_start_failed", "The job could not be scheduled; nothing was charged.", 502);
		}

		return jobId;
	};

	app.post("/scrape", async (c) => {
		const body: ScrapeBody = await parseBody(c.req.json(), scrapeBodySchema);
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
			convert: body.convert,
		};
		const result = await scrapePage(scrapeDeps(c.env, config), request);

		const stripeCustomerId = await customerIdOf(c.env, userId);
		await recordUsage(
			{
				repo: createBillingRepo(createDb(c.env)),
				config,
				stripe: createStripe(config),
				waitUntil: waitUntilOf(c),
			},
			{ userId, stripeCustomerId, operation: request.engine, credits: result.credits },
		);

		return c.json(result);
	});

	app.post("/batch", async (c) => {
		const body = await parseBody(c.req.json(), batchBodySchema);
		const userId = c.get("apiKeyUserId");
		await ensureSpendable(billingDeps(c.env, loadConfig(c.env)), userId);

		const jobId = await startJob(c.env, { userId, type: "batch", request: body, total: body.urls.length });
		return c.json({ jobId }, 202);
	});

	app.post("/crawl", async (c) => {
		const body = await parseBody(c.req.json(), crawlBodySchema);
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

		const page = await listPageResults(createJobResultsDeps(c.env, config), row.id, cursor, DEFAULT_RESULTS_PAGE_SIZE);

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
