import { and, count, eq, gt, inArray } from "drizzle-orm";

import type { BillingState } from "../billing/state";
import { isSpendable } from "../billing/state";
import { PlatformError } from "../core/types";
import type { PlatformDb } from "../db/client";
import { jobs } from "../db/schema";

/**
 * Per-account limits (owner decision 2026-10-01; docs/specs/platform/03_api.md "Rate limits").
 *
 * "Paid" means an active subscription — the same predicate the spend guard uses
 * (`isSpendable`), so an account that can spend beyond the free allowance also gets the paid
 * request rate and job concurrency, and nothing else does.
 */
export type Tier = "free" | "paid";

export interface TierLimits {
	/** `/v1` requests per minute per account (all keys together). */
	requestsPerMinute: number;
	/** Batch + crawl jobs (async scrape included) in `queued` or `running` at once. */
	concurrentJobs: number;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
	free: { requestsPerMinute: 60, concurrentJobs: 3 },
	paid: { requestsPerMinute: 600, concurrentJobs: 20 },
};

/** API keys one account may hold; enforced on Better Auth's create endpoint. */
export const MAX_API_KEYS_PER_ACCOUNT = 50;

/** Binding windows are 60 s, so a caller that waits this long always gets a fresh window. */
export const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

export const tierOf = (state: BillingState | undefined): Tier => (isSpendable(state) ? "paid" : "free");

/** The slice of a Workers Rate Limiting binding we use — a fake implements it in tests. */
export interface RateLimiter {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitLog {
	warn(message: string, detail?: Record<string, unknown>): void;
	error(message: string, detail?: Record<string, unknown>): void;
}

/**
 * Bindings named here have already logged a missing-binding warning in this isolate. Only a
 * log-noise guard — no decision depends on it, so per-isolate state is harmless.
 */
const warnedMissing = new Set<string>();

/**
 * One rate-limit check. A deployment without the binding (self-hosted without `ratelimits`, a
 * test harness) runs unlimited and warns once per isolate. A binding that throws fails
 * **open** by default — for `/v1` the API staying up matters more than a per-minute cap, and
 * spend is bounded by the billing guard; the unbilled demo passes `failClosed`.
 */
export const checkRateLimit = async (
	limiter: RateLimiter | undefined,
	params: { binding: string; key: string; failClosed?: boolean },
	log: RateLimitLog = console,
): Promise<boolean> => {
	if (!limiter) {
		if (!warnedMissing.has(params.binding)) {
			warnedMissing.add(params.binding);
			log.warn("rate_limit_binding_missing", { binding: params.binding });
		}
		return true;
	}
	try {
		const { success } = await limiter.limit({ key: params.key });
		return success;
	} catch (error) {
		log.error("rate_limit_binding_failed", {
			binding: params.binding,
			message: error instanceof Error ? error.message : String(error),
		});
		return !params.failClosed;
	}
};

/** Test-only: forget which bindings already warned. */
export const resetMissingBindingWarnings = (): void => warnedMissing.clear();

/** Which binding carries a tier's per-minute counter. */
export const tierRateLimitBinding = (tier: Tier): "RATE_LIMIT_FREE" | "RATE_LIMIT_PAID" =>
	tier === "paid" ? "RATE_LIMIT_PAID" : "RATE_LIMIT_FREE";

export const rateLimitedMessage = (tier: Tier): string =>
	`Rate limit exceeded: ${TIER_LIMITS[tier].requestsPerMinute} requests per minute per account on the ${tier} tier. Retry after ${RATE_LIMIT_RETRY_AFTER_SECONDS} seconds.`;

const ACTIVE_JOB_STATUSES = ["queued", "running"] as const;

/**
 * A queued/running job whose row has not moved for this long no longer counts: every finished
 * page bumps `updated_at` (a page step is bounded at a few minutes with retries), so silence
 * this long means a lost Workflow or a `scheduling_unknown` job, which must not hold the
 * account's capacity forever.
 */
export const STALE_ACTIVE_JOB_MS = 60 * 60 * 1000;

/** Active jobs for one account (`jobs_user_status_idx`), ignoring stale ones. */
export const countActiveJobs = async (db: PlatformDb, userId: string, now: Date = new Date()): Promise<number> => {
	const rows = await db
		.select({ value: count() })
		.from(jobs)
		.where(
			and(
				eq(jobs.userId, userId),
				inArray(jobs.status, [...ACTIVE_JOB_STATUSES]),
				gt(jobs.updatedAt, new Date(now.getTime() - STALE_ACTIVE_JOB_MS)),
			),
		);
	return rows[0]?.value ?? 0;
};

/**
 * Refuses a new job once the account has its tier's number of jobs queued or running. A check,
 * not a reservation: two creations racing past it can exceed the cap by the race width, which
 * is acceptable for a fairness limit (spend is guarded separately).
 */
export const ensureJobCapacity = async (
	deps: { countActiveJobs(userId: string): Promise<number> },
	userId: string,
	tier: Tier,
): Promise<void> => {
	const limit = TIER_LIMITS[tier].concurrentJobs;
	const active = await deps.countActiveJobs(userId);
	if (active < limit) return;
	throw new PlatformError(
		"too_many_jobs",
		`Too many active jobs: the ${tier} tier allows ${limit} batch/crawl jobs queued or running at once. Wait for one to finish and retry.`,
		429,
	);
};
