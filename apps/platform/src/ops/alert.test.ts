import { describe, expect, it, vi } from "vitest";

import { type OpsAlertDeps, alertCronFailure, alertProxyBandwidth, alertUsageBacklog, sendOpsAlert } from "./alert";

const NOW = new Date("2026-10-01T09:30:00.000Z");

const harness = (overrides: Partial<OpsAlertDeps> = {}) => {
	const store = new Map<string, { value: string; ttl?: number }>();
	const sent: { from: unknown; to: unknown; subject: string; text?: string }[] = [];
	const log = { warn: vi.fn(), error: vi.fn() };
	const deps: OpsAlertDeps = {
		email: {
			send: (message: unknown) => {
				sent.push(message as (typeof sent)[number]);
				return Promise.resolve({ messageId: "m" } as unknown as EmailSendResult);
			},
		} as Pick<SendEmail, "send">,
		to: "ops@example.com",
		kv: {
			get: (key) => Promise.resolve(store.get(key)?.value ?? null),
			put: (key, value, options) => {
				store.set(key, { value, ttl: options?.expirationTtl });
				return Promise.resolve();
			},
		},
		now: () => NOW,
		log,
		...overrides,
	};
	return { deps, store, sent, log };
};

const bandwidth = (threshold: number, ratio: number, periodStart = "2026-09-16T12:25:19Z") => ({
	threshold,
	ratio,
	usedBytes: ratio * 250e9,
	limitBytes: 250e9,
	periodStart,
	periodEnd: "2026-10-16T12:25:19Z",
});

describe("sendOpsAlert", () => {
	it("sends from the restricted sender to OPS_ALERT_EMAIL", async () => {
		const { deps, sent } = harness();
		expect(await sendOpsAlert(deps, { subject: "Hello", text: "body" })).toBe("sent");
		expect(sent).toEqual([
			{
				from: { email: "login@webforai.dev", name: "webforai platform ops" },
				to: "ops@example.com",
				subject: "[webforai ops] Hello",
				text: "body",
			},
		]);
	});

	it("only logs when no address is configured", async () => {
		const { deps, sent, log } = harness({ to: undefined });
		expect(await sendOpsAlert(deps, { subject: "Hello", text: "body" })).toBe("disabled");
		expect(sent).toEqual([]);
		expect(log.warn).toHaveBeenCalledOnce();
	});

	it("never throws, and leaves no dedupe marker when the send fails so the next run retries", async () => {
		const { deps, store, log } = harness({
			email: { send: () => Promise.reject(new Error("E_RATE_LIMIT_EXCEEDED")) } as Pick<SendEmail, "send">,
		});
		const outcome = await sendOpsAlert(deps, { subject: "x", text: "y", dedupe: { key: "k", ttlSeconds: 600 } });
		expect(outcome).toBe("failed");
		expect(store.size).toBe(0);
		expect(log.error).toHaveBeenCalledOnce();
	});
});

describe("alertProxyBandwidth", () => {
	it("emails once per threshold per period", async () => {
		const { deps, sent, store } = harness();
		expect(await alertProxyBandwidth(deps, bandwidth(0.8, 0.82))).toBe("sent");
		expect(await alertProxyBandwidth(deps, bandwidth(0.8, 0.85))).toBe("duplicate");
		expect(await alertProxyBandwidth(deps, bandwidth(0.95, 0.96))).toBe("sent");
		expect(await alertProxyBandwidth(deps, bandwidth(0.95, 0.99))).toBe("duplicate");
		// A new period starts the thresholds over.
		expect(await alertProxyBandwidth(deps, bandwidth(0.8, 0.81, "2026-10-16T12:25:19Z"))).toBe("sent");
		expect(sent.map((message) => message.subject)).toEqual([
			"[webforai ops] Proxy bandwidth at 82.0% of the monthly plan",
			"[webforai ops] Proxy bandwidth at 96.0% — proxy engines are refusing",
			"[webforai ops] Proxy bandwidth at 81.0% of the monthly plan",
		]);
		// The marker outlives the period by a day.
		const marker = store.get("ops:alert:proxy-bandwidth:0.8:2026-09-16T12:25:19Z");
		expect(marker?.ttl).toBe(Math.ceil((Date.parse("2026-10-16T12:25:19Z") - NOW.getTime()) / 1000) + 86_400);
	});
});

describe("alertCronFailure / alertUsageBacklog", () => {
	it("emails a cron failure at most once per hour", async () => {
		const { deps, sent } = harness();
		expect(await alertCronFailure(deps, new Error("stripe down"))).toBe("sent");
		expect(await alertCronFailure(deps, new Error("stripe still down"))).toBe("duplicate");
		expect(sent[0]?.text).toContain("stripe down");
	});

	it("emails a usage backlog at most once per day", async () => {
		const { deps, sent } = harness();
		const params = { count: 12, oldest: new Date("2026-10-01T07:00:00.000Z") };
		expect(await alertUsageBacklog(deps, params)).toBe("sent");
		expect(await alertUsageBacklog(deps, params)).toBe("duplicate");
		expect(sent[0]?.subject).toContain("12 usage events");
	});
});
