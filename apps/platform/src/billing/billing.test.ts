import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { PlatformError } from "../core/types";
import type { AppConfig } from "../env";
import { FREE_MONTHLY_CREDITS, monthlyCostMicroUsd } from "./credits";
import {
	DEFAULT_SPEND_CAP_USD,
	assertDemoRegionAllowed,
	ensureSpendable,
	monthStart,
	spendCapBodySchema,
	usesProxyTier,
} from "./guard";
import type { BillingRepo, UnreportedUsage, UsageCursor, UsageEventRow } from "./repo";
import { type BillingState, hasLiveSubscription } from "./state";
import {
	METER_EVENT_MAX_AGE_MS,
	classifyMeterError,
	isReportableAge,
	recordUsage,
	reportToStripe,
	retryUnreportedUsage,
} from "./usage";

const baseConfig = {
	BASE_URL: "https://example.test",
	BETTER_AUTH_SECRET: "x".repeat(32),
	STRIPE_METER_EVENT_NAME: "webforai_credits",
	billingEnabled: true,
	proxyEnabled: false,
	githubLoginEnabled: false,
} as AppConfig;

interface FakeRepoState {
	state?: BillingState;
	monthCredits?: number;
	/** Pending rows of users with a customer, already in queue order. */
	unreported?: UnreportedUsage[];
	customerless?: number;
	expired?: { id: string; credits: number }[];
	backlog?: { count: number; oldest: Date };
}

const after = (row: UnreportedUsage, cursor: UsageCursor | undefined): boolean =>
	!cursor ||
	row.createdAt.getTime() > cursor.createdAt.getTime() ||
	(row.createdAt.getTime() === cursor.createdAt.getTime() && row.id > cursor.id);

const fakeRepo = (init: FakeRepoState = {}) => {
	const inserted: UsageEventRow[] = [];
	const reported: { id: string; at: Date }[] = [];
	const rejected: string[] = [];
	const caps: { userId: string; usd: number }[] = [];
	const expiredBefore: Date[] = [];
	const repo: BillingRepo = {
		getBillingState: async () => init.state,
		sumMonthCredits: async () => init.monthCredits ?? 0,
		insertUsage: async (row) => {
			inserted.push(row);
		},
		markReported: async (id, at) => {
			reported.push({ id, at });
		},
		markRejected: async (id) => {
			rejected.push(id);
		},
		// Like the SQL: reported and rejected rows leave the queue, keyset continues after `cursor`.
		listUnreported: async (limit, cursor) =>
			(init.unreported ?? [])
				.filter((row) => !(reported.some((r) => r.id === row.id) || rejected.includes(row.id)) && after(row, cursor))
				.slice(0, limit),
		skipCustomerless: async () => init.customerless ?? 0,
		skipExpired: async (before) => {
			expiredBefore.push(before);
			return init.expired ?? [];
		},
		pendingBacklog: async () => init.backlog,
		setSpendCap: async (userId, usd) => {
			caps.push({ userId, usd });
		},
		listRecentUsage: async () => inserted,
	};
	return { repo, inserted, reported, rejected, caps, expiredBefore };
};

const row = (id: string, createdAt = new Date("2026-08-10T00:00:00Z")): UnreportedUsage => ({
	id,
	userId: "u1",
	credits: 1,
	createdAt,
	stripeCustomerId: "cus_1",
});

const activeState: BillingState = {
	userId: "u1",
	stripeCustomerId: "cus_1",
	status: "active",
	stripeSubscriptionId: "sub_1",
	currentPeriodEnd: null,
	spendCapUsd: null,
};

/** Real stripe@22 error instances, as `generateV1Error` builds them from a response. */
const invalidRequest = (raw: { message: string; code?: string; param?: string; statusCode?: number }) =>
	new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", statusCode: 400, ...raw });

const meterStub = () => {
	const create = vi.fn(async () => ({}));
	return { stripe: { billing: { meterEvents: { create } } } as never, create };
};

describe("monthStart", () => {
	it("returns the UTC first-of-month midnight", () => {
		expect(monthStart(new Date("2026-08-10T23:30:00Z")).toISOString()).toBe("2026-08-01T00:00:00.000Z");
	});
});

describe("ensureSpendable", () => {
	it("allows an active subscription beyond the free allowance, below its cap", async () => {
		const { repo } = fakeRepo({ state: activeState, monthCredits: 10_000 });
		await expect(ensureSpendable({ repo, config: baseConfig }, "u1")).resolves.toBeUndefined();
	});

	it("allows a free user below the allowance", async () => {
		const { repo } = fakeRepo({ monthCredits: FREE_MONTHLY_CREDITS - 1 });
		await expect(ensureSpendable({ repo, config: baseConfig }, "u1")).resolves.toBeUndefined();
	});

	it("rejects a free user at the allowance with 402", async () => {
		const { repo } = fakeRepo({ monthCredits: FREE_MONTHLY_CREDITS });
		const error = await ensureSpendable({ repo, config: baseConfig }, "u1").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(PlatformError);
		expect((error as PlatformError).code).toBe("payment_required");
		expect((error as PlatformError).status).toBe(402);
	});

	it("rejects past_due like a free user", async () => {
		const { repo } = fakeRepo({
			state: { ...activeState, status: "past_due" },
			monthCredits: FREE_MONTHLY_CREDITS,
		});
		await expect(ensureSpendable({ repo, config: baseConfig }, "u1")).rejects.toBeInstanceOf(PlatformError);
	});

	it("mentions the missing billing configuration when Stripe is off", async () => {
		const { repo } = fakeRepo({ monthCredits: FREE_MONTHLY_CREDITS });
		const config = { ...baseConfig, billingEnabled: false };
		const error = (await ensureSpendable({ repo, config }, "u1").catch((e: unknown) => e)) as PlatformError;
		expect(error.message).toContain("billing is not configured");
	});
});

describe("recordUsage", () => {
	it("reports a committed page with its durable identifier and creates no replacement ledger row", async () => {
		const { repo, inserted, reported } = fakeRepo();
		const { stripe, create } = meterStub();
		const page = {
			id: "job_1:page:2",
			stripeCustomerId: "cus_1",
			credits: 5,
			createdAt: new Date("2026-08-09T12:00:00.900Z"),
		};
		await reportToStripe({ repo, config: baseConfig, stripe }, page);
		expect(create).toHaveBeenCalledWith({
			event_name: "webforai_credits",
			identifier: page.id,
			// The usage time, in whole seconds, so a late retry lands in the period it belongs to.
			timestamp: Math.floor(Date.parse("2026-08-09T12:00:00Z") / 1000),
			payload: { stripe_customer_id: "cus_1", value: "5" },
		});
		expect(inserted).toEqual([]);
		expect(reported).toMatchObject([{ id: page.id }]);
	});
	it("writes a ledger row and reports it to the meter", async () => {
		const { repo, inserted, reported } = fakeRepo();
		const { stripe, create } = meterStub();
		const now = new Date("2026-08-10T00:00:00Z");

		const id = await recordUsage(
			{ repo, config: baseConfig, stripe, now: () => now },
			{ userId: "u1", stripeCustomerId: "cus_1", operation: "scrape:fetch", credits: 3 },
		);

		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toMatchObject({ id, userId: "u1", credits: 3, reportedAt: null });
		expect(create).toHaveBeenCalledWith({
			event_name: "webforai_credits",
			identifier: id,
			timestamp: now.getTime() / 1000,
			payload: { stripe_customer_id: "cus_1", value: "3" },
		});
		expect(reported).toEqual([{ id, at: now }]);
	});

	it("keeps the ledger row unreported when the meter call fails", async () => {
		const { repo, inserted, reported } = fakeRepo();
		const stripe = {
			billing: { meterEvents: { create: vi.fn(async () => Promise.reject(new Error("429"))) } },
		} as never;

		await expect(
			recordUsage(
				{ repo, config: baseConfig, stripe },
				{ userId: "u1", stripeCustomerId: "cus_1", operation: "scrape", credits: 1 },
			),
		).resolves.toBeTypeOf("string");

		expect(inserted).toHaveLength(1);
		expect(reported).toHaveLength(0);
	});

	it("skips Stripe when billing is disabled or no customer exists", async () => {
		const { repo, inserted } = fakeRepo();
		const { stripe, create } = meterStub();

		await recordUsage({ repo, config: baseConfig, stripe }, { userId: "u1", operation: "scrape", credits: 1 });
		await recordUsage(
			{ repo, config: { ...baseConfig, billingEnabled: false }, stripe },
			{ userId: "u1", stripeCustomerId: "cus_1", operation: "scrape", credits: 1 },
		);

		expect(inserted).toHaveLength(2);
		expect(create).not.toHaveBeenCalled();
	});

	it("defers the meter call to waitUntil when provided", async () => {
		const { repo, reported } = fakeRepo();
		const { stripe, create } = meterStub();
		const pending: Promise<unknown>[] = [];

		await recordUsage(
			{ repo, config: baseConfig, stripe, waitUntil: (p) => pending.push(p) },
			{ userId: "u1", stripeCustomerId: "cus_1", operation: "scrape", credits: 2 },
		);

		expect(pending).toHaveLength(1);
		await Promise.all(pending);
		expect(create).toHaveBeenCalledTimes(1);
		expect(reported).toHaveLength(1);
	});

	it("generates monotonically sortable ids", async () => {
		const { repo, inserted } = fakeRepo();
		await recordUsage(
			{ repo, config: baseConfig, now: () => new Date(1) },
			{ userId: "u1", operation: "a", credits: 1 },
		);
		await recordUsage(
			{ repo, config: baseConfig, now: () => new Date(2) },
			{ userId: "u1", operation: "b", credits: 1 },
		);
		const [first, second] = inserted;
		expect(first?.id.length).toBe(26);
		expect(String(first?.id) < String(second?.id)).toBe(true);
	});
});

describe("retryUnreportedUsage", () => {
	const now = new Date("2026-10-01T00:00:00Z");
	const quietLogs = () => {
		vi.spyOn(console, "info").mockImplementation(() => undefined);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		return vi.spyOn(console, "error").mockImplementation(() => undefined);
	};

	it("takes customerless and expired rows out of the queue before draining", async () => {
		const errors = quietLogs();
		const { repo, reported, expiredBefore } = fakeRepo({
			unreported: [row("a")],
			customerless: 150,
			expired: [
				{ id: "old1", credits: 2 },
				{ id: "old2", credits: 3 },
			],
		});
		const { stripe } = meterStub();

		await expect(retryUnreportedUsage({ repo, config: baseConfig, stripe, now: () => now })).resolves.toBe(1);
		expect(reported.map((r) => r.id)).toEqual(["a"]);
		expect(expiredBefore).toEqual([new Date(now.getTime() - METER_EVENT_MAX_AGE_MS)]);
		expect(errors).toHaveBeenCalledWith("usage_report_expired", expect.objectContaining({ rows: 2, credits: 5 }));
	});

	it("drains several pages in one run, bounded by maxPages", async () => {
		quietLogs();
		const rows = Array.from({ length: 7 }, (_, index) => row(`r${index}`, new Date(Date.UTC(2026, 8, 20, 0, index))));
		const { repo, reported } = fakeRepo({ unreported: rows });
		const { stripe, create } = meterStub();

		await expect(retryUnreportedUsage({ repo, config: baseConfig, stripe, now: () => now }, 2, 3)).resolves.toBe(6);
		expect(create).toHaveBeenCalledTimes(6);
		expect(reported.map((r) => r.id)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
	});

	it("takes a row Stripe rejects out of the queue, logs it, and keeps draining", async () => {
		const errors = quietLogs();
		const { repo, reported, rejected } = fakeRepo({
			unreported: [
				row("bad", new Date("2026-09-20T00:00:00Z")),
				row("good", new Date("2026-09-20T00:01:00Z")),
				row("next", new Date("2026-09-20T00:02:00Z")),
			],
		});
		const create = vi.fn(async (params: { identifier: string }) => {
			if (params.identifier === "bad") {
				throw invalidRequest({ message: "No such customer: 'cus_1'", code: "resource_missing", statusCode: 404 });
			}
			return {};
		});
		const stripe = { billing: { meterEvents: { create } } } as never;

		await expect(retryUnreportedUsage({ repo, config: baseConfig, stripe, now: () => now }, 2, 5)).resolves.toBe(2);
		expect(reported.map((r) => r.id)).toEqual(["good", "next"]);
		expect(rejected).toEqual(["bad"]);
		expect(errors).toHaveBeenCalledWith(
			"usage_report_rejected",
			expect.objectContaining({ id: "bad", stripeCustomerId: "cus_1", code: "resource_missing", statusCode: 404 }),
		);
	});

	it("does not let a head of rejected rows starve newer billable rows across passes", async () => {
		quietLogs();
		// The test→live key switch: every old row names a customer the live account lacks.
		const stale = Array.from({ length: 5 }, (_, index) => ({
			...row(`stale${index}`, new Date(Date.UTC(2026, 8, 20, 0, index))),
			stripeCustomerId: "cus_test",
		}));
		const fresh = [row("fresh", new Date("2026-09-21T00:00:00Z"))];
		const { repo, reported, rejected } = fakeRepo({ unreported: [...stale, ...fresh] });
		const create = vi.fn(async (params: { payload: { stripe_customer_id: string } }) => {
			if (params.payload.stripe_customer_id === "cus_test") throw invalidRequest({ message: "No such customer" });
			return {};
		});
		const stripe = { billing: { meterEvents: { create } } } as never;

		await expect(retryUnreportedUsage({ repo, config: baseConfig, stripe, now: () => now }, 2, 5)).resolves.toBe(1);
		expect(reported.map((r) => r.id)).toEqual(["fresh"]);
		expect(rejected).toHaveLength(5);

		// The next pass does not revisit them.
		create.mockClear();
		await expect(retryUnreportedUsage({ repo, config: baseConfig, stripe, now: () => now }, 2, 5)).resolves.toBe(0);
		expect(create).not.toHaveBeenCalled();
	});

	it("treats a duplicate identifier as already reported", async () => {
		const infos = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const { repo, reported, rejected } = fakeRepo({ unreported: [row("dup")] });
		const create = vi.fn(async () => {
			throw invalidRequest({
				message: "An event with identifier 'dup' already exists.",
				code: "resource_already_exists",
			});
		});
		const stripe = { billing: { meterEvents: { create } } } as never;

		await expect(retryUnreportedUsage({ repo, config: baseConfig, stripe, now: () => now })).resolves.toBe(1);
		expect(reported).toEqual([{ id: "dup", at: now }]);
		expect(rejected).toEqual([]);
		expect(infos).toHaveBeenCalledWith("usage_report_duplicate", expect.objectContaining({ id: "dup" }));
	});

	it("stops, marking nothing, on a rejection that names the meter configuration", async () => {
		quietLogs();
		const rows = Array.from({ length: 6 }, (_, index) => row(`r${index}`, new Date(Date.UTC(2026, 8, 20, 0, index))));
		const { repo, reported, rejected } = fakeRepo({ unreported: rows });
		const create = vi.fn(async () => {
			throw invalidRequest({ message: "No active meter found for event_name", param: "event_name" });
		});
		const stripe = { billing: { meterEvents: { create } } } as never;

		await expect(retryUnreportedUsage({ repo, config: baseConfig, stripe, now: () => now }, 2, 5)).resolves.toBe(0);
		expect(create).toHaveBeenCalledTimes(1);
		expect(reported).toEqual([]);
		expect(rejected).toEqual([]);
	});

	it.each([
		["rate limit", new Stripe.errors.StripeRateLimitError({ message: "Too many requests", statusCode: 429 })],
		["5xx", new Stripe.errors.StripeAPIError({ message: "Internal error", statusCode: 500 })],
		["network", new Stripe.errors.StripeConnectionError({ message: "fetch failed" })],
		["bad key", new Stripe.errors.StripeAuthenticationError({ message: "Invalid API Key", statusCode: 401 })],
	])("stops the run on a %s failure and keeps the rows queued", async (_label, failure) => {
		quietLogs();
		const { repo, reported, rejected } = fakeRepo({
			unreported: [row("a"), row("b", new Date("2026-08-11T00:00:00Z"))],
		});
		const create = vi.fn(async () => {
			throw failure;
		});
		const stripe = { billing: { meterEvents: { create } } } as never;

		await expect(retryUnreportedUsage({ repo, config: baseConfig, stripe, now: () => now })).resolves.toBe(0);
		expect(create).toHaveBeenCalledTimes(1);
		expect(reported).toEqual([]);
		expect(rejected).toEqual([]);
	});

	it("reports a backlog left after the pass, and survives the alert failing", async () => {
		const errors = quietLogs();
		const oldest = new Date("2026-09-30T20:00:00Z");
		const { repo } = fakeRepo({ backlog: { count: 3, oldest } });
		const { stripe } = meterStub();
		const onBacklog = vi.fn(async () => {
			throw new Error("mail down");
		});

		await expect(retryUnreportedUsage({ repo, config: baseConfig, stripe, now: () => now, onBacklog })).resolves.toBe(
			0,
		);
		expect(onBacklog).toHaveBeenCalledWith({ count: 3, oldest });
		expect(errors).toHaveBeenCalledWith("usage_backlog_alert_failed", expect.anything());

		const quiet = fakeRepo({});
		const notCalled = vi.fn(async () => undefined);
		await retryUnreportedUsage({ repo: quiet.repo, config: baseConfig, stripe, now: () => now, onBacklog: notCalled });
		expect(notCalled).not.toHaveBeenCalled();
	});

	it("does nothing when billing is disabled", async () => {
		const { repo } = fakeRepo({ unreported: [row("a")] });
		const { stripe, create } = meterStub();
		await expect(
			retryUnreportedUsage({ repo, config: { ...baseConfig, billingEnabled: false }, stripe }),
		).resolves.toBe(0);
		expect(create).not.toHaveBeenCalled();
	});
});

describe("classifyMeterError", () => {
	it("separates duplicates, permanent rejections and retryable failures", () => {
		expect(classifyMeterError(invalidRequest({ message: "x", code: "resource_already_exists" }))).toBe("duplicate");
		expect(
			classifyMeterError(invalidRequest({ message: "Duplicate meter event identifier", param: "identifier" })),
		).toBe("duplicate");
		expect(classifyMeterError(invalidRequest({ message: "No such customer: 'cus_x'", code: "resource_missing" }))).toBe(
			"rejected",
		);
		// "already exists" without naming the identifier is not trusted as billed.
		expect(classifyMeterError(invalidRequest({ message: "Customer already exists" }))).toBe("rejected");
		expect(classifyMeterError(invalidRequest({ message: "Meter archived", code: "archived_meter" }))).toBe("retry");
		expect(classifyMeterError(new Stripe.errors.StripePermissionError({ message: "Forbidden", statusCode: 403 }))).toBe(
			"retry",
		);
		expect(
			classifyMeterError(new Stripe.errors.StripeIdempotencyError({ message: "Keys reused", statusCode: 400 })),
		).toBe("retry");
		expect(classifyMeterError(new Error("D1_ERROR"))).toBe("retry");
		expect(classifyMeterError(undefined)).toBe("retry");
	});
});

describe("isReportableAge", () => {
	it("accepts rows inside the meter's 35-day window and refuses older ones", () => {
		const now = new Date("2026-10-01T00:00:00Z");
		expect(isReportableAge(new Date("2026-09-01T00:00:00Z"), now)).toBe(true);
		expect(isReportableAge(new Date("2026-08-27T00:00:00Z"), now)).toBe(false);
	});
});

describe("proxy tier", () => {
	it("classifies proxy engines and region-pinned auto as the proxy tier", () => {
		expect(usesProxyTier({ engine: "proxy-fetch" })).toBe(true);
		expect(usesProxyTier({ engine: "proxy-browser", region: "auto" })).toBe(true);
		expect(usesProxyTier({ engine: "auto", region: "jp" })).toBe(true);
		expect(usesProxyTier({ engine: "auto", region: "auto" })).toBe(false);
		expect(usesProxyTier({ engine: "auto" })).toBe(false);
		// Concrete non-proxy engines ignore a region.
		expect(usesProxyTier({ engine: "fetch", region: "jp" })).toBe(false);
		expect(usesProxyTier({ engine: "browser", region: "jp" })).toBe(false);
	});

	it("refuses the proxy tier without an active subscription, naming the dashboard", async () => {
		const { repo } = fakeRepo({ monthCredits: 0 });
		const error = (await ensureSpendable({ repo, config: baseConfig }, "u1", { proxy: true }).catch(
			(e: unknown) => e,
		)) as PlatformError;
		expect(error.code).toBe("payment_required");
		expect(error.status).toBe(402);
		expect(error.message).toContain("https://example.test/dashboard");
	});

	it("refuses the proxy tier while past_due", async () => {
		const { repo } = fakeRepo({ state: { ...activeState, status: "past_due" } });
		await expect(ensureSpendable({ repo, config: baseConfig }, "u1", { proxy: true })).rejects.toMatchObject({
			code: "payment_required",
		});
	});

	it("allows the proxy tier for subscribers, and on deployments without billing", async () => {
		const subscribed = fakeRepo({ state: activeState });
		await expect(
			ensureSpendable({ repo: subscribed.repo, config: baseConfig }, "u1", { proxy: true }),
		).resolves.toBeUndefined();
		const selfHosted = fakeRepo({});
		await expect(
			ensureSpendable({ repo: selfHosted.repo, config: { ...baseConfig, billingEnabled: false } }, "u1", {
				proxy: true,
			}),
		).resolves.toBeUndefined();
	});

	it("keeps proxy regions out of the free demo", () => {
		expect(() => assertDemoRegionAllowed("auto", "https://example.test/dashboard")).not.toThrow();
		expect(() => assertDemoRegionAllowed("jp", "https://example.test/dashboard")).toThrow(
			expect.objectContaining({ code: "payment_required", status: 402 }),
		);
	});
});

describe("spend cap", () => {
	/** Credits at which the month's estimate reaches exactly `usd`. */
	const creditsFor = (usd: number) => FREE_MONTHLY_CREDITS + usd * 1_000;

	it("prices the boundary exactly in micro-dollars", () => {
		expect(monthlyCostMicroUsd(creditsFor(DEFAULT_SPEND_CAP_USD))).toBe(50_000_000);
	});

	it("admits operations until one more credit would pass the default $50 cap", async () => {
		const below = fakeRepo({ state: activeState, monthCredits: creditsFor(50) - 1 });
		await expect(ensureSpendable({ repo: below.repo, config: baseConfig }, "u1")).resolves.toBeUndefined();

		const at = fakeRepo({ state: activeState, monthCredits: creditsFor(50) });
		const error = (await ensureSpendable({ repo: at.repo, config: baseConfig }, "u1").catch(
			(e: unknown) => e,
		)) as PlatformError;
		expect(error.code).toBe("spend_cap_reached");
		expect(error.status).toBe(402);
		expect(error.message).toContain("$50");
		expect(error.message).toContain("https://example.test/dashboard");
	});

	it("uses the user's own cap", async () => {
		const state = { ...activeState, spendCapUsd: 1 };
		const ok = fakeRepo({ state, monthCredits: creditsFor(1) - 1 });
		await expect(ensureSpendable({ repo: ok.repo, config: baseConfig }, "u1")).resolves.toBeUndefined();
		const over = fakeRepo({ state, monthCredits: creditsFor(1) });
		await expect(ensureSpendable({ repo: over.repo, config: baseConfig }, "u1")).rejects.toMatchObject({
			code: "spend_cap_reached",
		});
		const raised = fakeRepo({ state: { ...activeState, spendCapUsd: 5_000 }, monthCredits: creditsFor(60) });
		await expect(ensureSpendable({ repo: raised.repo, config: baseConfig }, "u1")).resolves.toBeUndefined();
	});

	it("validates the dashboard body: whole dollars from $1 to $5,000", () => {
		expect(spendCapBodySchema.safeParse({ spendCapUsd: 1 }).success).toBe(true);
		expect(spendCapBodySchema.safeParse({ spendCapUsd: 5_000 }).success).toBe(true);
		for (const spendCapUsd of [0, 5_001, 12.5, null, "50"]) {
			expect(spendCapBodySchema.safeParse({ spendCapUsd }).success).toBe(false);
		}
		expect(spendCapBodySchema.safeParse({}).success).toBe(false);
	});
});

describe("hasLiveSubscription", () => {
	it("treats active and past_due mirrors, and live Stripe statuses, as subscribed", () => {
		expect(hasLiveSubscription(undefined)).toBe(false);
		expect(hasLiveSubscription({ status: "active" })).toBe(true);
		expect(hasLiveSubscription({ status: "past_due" })).toBe(true);
		expect(hasLiveSubscription({ status: "canceled" })).toBe(false);
		expect(hasLiveSubscription([{ status: "canceled" }, { status: "trialing" }])).toBe(true);
		expect(hasLiveSubscription([{ status: "unpaid" }])).toBe(true);
		expect(hasLiveSubscription([{ status: "incomplete_expired" }, { status: "canceled" }])).toBe(false);
		expect(hasLiveSubscription([])).toBe(false);
	});
});
