import { describe, expect, it, vi } from "vitest";
import { PlatformError } from "../core/types";
import type { AppConfig } from "../env";
import { FREE_MONTHLY_CREDITS } from "./credits";
import { ensureSpendable, monthStart } from "./guard";
import type { BillingRepo, UnreportedUsage, UsageEventRow } from "./repo";
import type { BillingState } from "./state";
import { recordUsage, retryUnreportedUsage } from "./usage";

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
	unreported?: UnreportedUsage[];
}

const fakeRepo = (init: FakeRepoState = {}) => {
	const inserted: UsageEventRow[] = [];
	const reported: { id: string; at: Date }[] = [];
	const repo: BillingRepo = {
		getBillingState: async () => init.state,
		sumMonthCredits: async () => init.monthCredits ?? 0,
		insertUsage: async (row) => {
			inserted.push(row);
		},
		markReported: async (id, at) => {
			reported.push({ id, at });
		},
		listUnreported: async () => init.unreported ?? [],
		listRecentUsage: async () => inserted,
	};
	return { repo, inserted, reported };
};

const activeState: BillingState = {
	userId: "u1",
	stripeCustomerId: "cus_1",
	status: "active",
	stripeSubscriptionId: "sub_1",
	currentPeriodEnd: null,
};

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
	it("allows an active subscription regardless of consumption", async () => {
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
	it("reports pending rows and skips those without a customer", async () => {
		const { repo, reported } = fakeRepo({
			unreported: [
				{ id: "a", userId: "u1", credits: 1, stripeCustomerId: "cus_1" },
				{ id: "b", userId: "u2", credits: 2, stripeCustomerId: null },
			],
		});
		const { stripe, create } = meterStub();

		await expect(retryUnreportedUsage({ repo, config: baseConfig, stripe })).resolves.toBe(1);
		expect(create).toHaveBeenCalledTimes(1);
		expect(reported.map((r) => r.id)).toEqual(["a"]);
	});

	it("does nothing when billing is disabled", async () => {
		const { repo } = fakeRepo({ unreported: [{ id: "a", userId: "u1", credits: 1, stripeCustomerId: "cus_1" }] });
		const { stripe, create } = meterStub();
		await expect(
			retryUnreportedUsage({ repo, config: { ...baseConfig, billingEnabled: false }, stripe }),
		).resolves.toBe(0);
		expect(create).not.toHaveBeenCalled();
	});
});
