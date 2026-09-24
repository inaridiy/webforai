import { describe, expect, it, vi } from "vitest";
import {
	type BandwidthKv,
	PROXY_BANDWIDTH_KEY,
	type ProxyAccountApi,
	SNAPSHOT_TTL_SECONDS,
	proxyBandwidthRefusal,
	refreshProxyBandwidth,
} from "./bandwidth";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const GB = 1_000_000_000;

const fakeKv = () => {
	const store = new Map<string, { value: string; ttl?: number }>();
	const kv: BandwidthKv = {
		get: (key) => Promise.resolve(store.get(key)?.value ?? null),
		put: (key, value, options) => {
			store.set(key, { value, ttl: options?.expirationTtl });
			return Promise.resolve();
		},
	};
	return { kv, store };
};

const fakeApi = (usedBytes: number, limitGb = 250) => {
	const calls: string[] = [];
	const api: ProxyAccountApi = {
		baseUrl: "https://proxy-provider.example/api/v2/",
		apiKey: "test-key",
		fetch: (input, init) => {
			calls.push(`${input} ${new Headers(init?.headers).get("authorization")}`);
			const path = new URL(input).pathname;
			const body = path.endsWith("/subscription/")
				? { plan: 7, start_date: "2026-09-16T12:25:19Z", end_date: "2026-10-16T12:25:19Z" }
				: path.endsWith("/subscription/plan/")
					? {
							results: [
								{ id: 3, status: "cancelled", bandwidth_limit: 1 },
								{ id: 7, status: "active", bandwidth_limit: limitGb },
							],
						}
					: { bandwidth_total: usedBytes };
			return Promise.resolve(new Response(JSON.stringify(body)));
		},
	};
	return { api, calls };
};

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe("refreshProxyBandwidth", () => {
	it("stores the period's usage and cap with an expiring snapshot", async () => {
		const { kv, store } = fakeKv();
		const { api, calls } = fakeApi(12 * GB);
		const logger = log();

		const snapshot = await refreshProxyBandwidth({ kv, api, now: () => NOW, log: logger });

		expect(snapshot).toEqual({
			usedBytes: 12 * GB,
			limitBytes: 250 * GB,
			periodStart: "2026-09-16T12:25:19Z",
			periodEnd: "2026-10-16T12:25:19Z",
			checkedAt: NOW.toISOString(),
		});
		expect(store.get(PROXY_BANDWIDTH_KEY)?.ttl).toBe(SNAPSHOT_TTL_SECONDS);
		expect(calls[2]).toContain("stats/aggregate/?timestamp__gte=2026-09-16T12%3A25%3A19Z");
		expect(calls[2]).toContain(`timestamp__lte=${encodeURIComponent(NOW.toISOString())}`);
		expect(calls.every((call) => call.endsWith("Token test-key"))).toBe(true);
		expect(logger.info).toHaveBeenCalledOnce();
	});

	it("warns from 80% and reports exhaustion from 95%", async () => {
		const warnLog = log();
		await refreshProxyBandwidth({ kv: fakeKv().kv, api: fakeApi(200 * GB).api, now: () => NOW, log: warnLog });
		expect(warnLog.warn).toHaveBeenCalledOnce();

		const errorLog = log();
		await refreshProxyBandwidth({ kv: fakeKv().kv, api: fakeApi(240 * GB).api, now: () => NOW, log: errorLog });
		expect(errorLog.error).toHaveBeenCalledOnce();
	});

	it("treats a zero limit as an uncapped plan", async () => {
		const snapshot = await refreshProxyBandwidth({
			kv: fakeKv().kv,
			api: fakeApi(999 * GB, 0).api,
			now: () => NOW,
			log: log(),
		});
		expect(snapshot.limitBytes).toBeNull();
	});
});

describe("proxyBandwidthRefusal", () => {
	const store = async (usedGb: number) => {
		const { kv } = fakeKv();
		await refreshProxyBandwidth({ kv, api: fakeApi(usedGb * GB).api, now: () => NOW, log: log() });
		return kv;
	};

	it("lets requests through below the stop threshold", async () => {
		expect(await proxyBandwidthRefusal(await store(200), NOW)).toBeUndefined();
	});

	it("refuses at 95% until the period ends", async () => {
		const kv = await store(240);
		expect(await proxyBandwidthRefusal(kv, NOW)).toContain("2026-10-16T12:25:19Z");
		expect(await proxyBandwidthRefusal(kv, new Date("2026-10-16T12:25:20Z"))).toBeUndefined();
	});

	it("fails open without a snapshot, on garbage, or when KV fails", async () => {
		expect(await proxyBandwidthRefusal(fakeKv().kv, NOW)).toBeUndefined();
		const { kv, store: raw } = fakeKv();
		raw.set(PROXY_BANDWIDTH_KEY, { value: "not json" });
		expect(await proxyBandwidthRefusal(kv, NOW)).toBeUndefined();
		const failing: BandwidthKv = { get: () => Promise.reject(new Error("KV down")), put: () => Promise.resolve() };
		expect(await proxyBandwidthRefusal(failing, NOW)).toBeUndefined();
	});
});
