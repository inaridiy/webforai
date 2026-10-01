import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformError } from "../core/types";
import {
	MAX_API_KEYS_PER_ACCOUNT,
	type RateLimiter,
	TIER_LIMITS,
	checkRateLimit,
	ensureJobCapacity,
	resetMissingBindingWarnings,
	tierOf,
	tierRateLimitBinding,
} from "./limits";

/** A Workers Rate Limiting binding stand-in: `limit` successes per key, then refusals. */
const fakeRateLimiter = (limit: number) => {
	const counts = new Map<string, number>();
	const keys: string[] = [];
	const limiter: RateLimiter = {
		limit: ({ key }) => {
			keys.push(key);
			const next = (counts.get(key) ?? 0) + 1;
			counts.set(key, next);
			return Promise.resolve({ success: next <= limit });
		},
	};
	return { limiter, keys };
};

const log = () => ({ warn: vi.fn(), error: vi.fn() });

afterEach(() => resetMissingBindingWarnings());

describe("owner-decided limits", () => {
	it("pins the tier numbers and the key cap", () => {
		expect(TIER_LIMITS).toEqual({
			free: { requestsPerMinute: 60, concurrentJobs: 3 },
			paid: { requestsPerMinute: 600, concurrentJobs: 20 },
		});
		expect(MAX_API_KEYS_PER_ACCOUNT).toBe(50);
	});

	it("treats only an active subscription as paid", () => {
		const state = (status: "none" | "active" | "past_due" | "canceled") =>
			({ status }) as unknown as Parameters<typeof tierOf>[0];
		expect(tierOf(undefined)).toBe("free");
		expect(tierOf(state("active"))).toBe("paid");
		expect(tierOf(state("past_due"))).toBe("free");
		expect(tierOf(state("canceled"))).toBe("free");
		expect(tierRateLimitBinding("free")).toBe("RATE_LIMIT_FREE");
		expect(tierRateLimitBinding("paid")).toBe("RATE_LIMIT_PAID");
	});
});

describe("checkRateLimit", () => {
	it("allows until the binding refuses, per key", async () => {
		const { limiter } = fakeRateLimiter(2);
		const check = (key: string) => checkRateLimit(limiter, { binding: "RATE_LIMIT_FREE", key }, log());
		expect(await check("user_a")).toBe(true);
		expect(await check("user_a")).toBe(true);
		expect(await check("user_a")).toBe(false);
		expect(await check("user_b")).toBe(true);
	});

	it("runs unlimited without a binding and warns once per binding", async () => {
		const logger = log();
		expect(await checkRateLimit(undefined, { binding: "RATE_LIMIT_FREE", key: "u" }, logger)).toBe(true);
		expect(await checkRateLimit(undefined, { binding: "RATE_LIMIT_FREE", key: "u" }, logger)).toBe(true);
		expect(await checkRateLimit(undefined, { binding: "DEMO_RATE_LIMIT", key: "u" }, logger)).toBe(true);
		expect(logger.warn).toHaveBeenCalledTimes(2);
	});

	it("fails open by default and closed on request when the binding throws", async () => {
		const broken: RateLimiter = { limit: () => Promise.reject(new Error("binding down")) };
		const logger = log();
		expect(await checkRateLimit(broken, { binding: "RATE_LIMIT_FREE", key: "u" }, logger)).toBe(true);
		expect(await checkRateLimit(broken, { binding: "DEMO_RATE_LIMIT", key: "u", failClosed: true }, logger)).toBe(
			false,
		);
		expect(logger.error).toHaveBeenCalledTimes(2);
	});
});

describe("ensureJobCapacity", () => {
	const withActive = (active: number) => ({ countActiveJobs: () => Promise.resolve(active) });

	it("allows below the tier's concurrent-job limit", async () => {
		await expect(ensureJobCapacity(withActive(2), "u", "free")).resolves.toBeUndefined();
		await expect(ensureJobCapacity(withActive(19), "u", "paid")).resolves.toBeUndefined();
	});

	it("refuses with 429 too_many_jobs naming the limit and tier", async () => {
		const free = await ensureJobCapacity(withActive(3), "u", "free").catch((error: unknown) => error);
		expect(free).toBeInstanceOf(PlatformError);
		expect(free).toMatchObject({ code: "too_many_jobs", status: 429 });
		expect((free as Error).message).toContain("free tier allows 3");

		const paid = await ensureJobCapacity(withActive(20), "u", "paid").catch((error: unknown) => error);
		expect(paid).toMatchObject({ code: "too_many_jobs", status: 429 });
		expect((paid as Error).message).toContain("paid tier allows 20");
	});
});
