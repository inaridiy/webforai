import type { FetchLike } from "../core/rehost";

/**
 * Egress-proxy bandwidth guard.
 *
 * The rotating-proxy plan is a flat monthly subscription with a bandwidth cap; past the cap the
 * provider stops every proxy until the period renews, which would fail `proxy-fetch`,
 * `proxy-browser`, region-pinned `auto` and the region-pinned demo for everyone at once. The
 * 15-minute cron reads the provider's account API (v2 `subscription`, `subscription/plan`,
 * `stats/aggregate`) into KV; the proxy engines refuse with `503 engine_unavailable` once usage
 * crosses `STOP_RATIO`, keeping the last few percent for requests already in flight.
 *
 * The snapshot expires after `SNAPSHOT_TTL_SECONDS`: if the cron or the account API stops
 * working, the guard fails open rather than blocking the proxy engines on stale numbers.
 * Deployments without `PROXY_ACCOUNT_API_URL` / `PROXY_ACCOUNT_API_KEY` skip all of this.
 */

export const PROXY_BANDWIDTH_KEY = "proxy:bandwidth";
export const WARN_RATIO = 0.8;
export const STOP_RATIO = 0.95;
/** Four missed cron runs, then the guard opens. */
export const SNAPSHOT_TTL_SECONDS = 60 * 60;

const BYTES_PER_GB = 1_000_000_000;

export interface BandwidthSnapshot {
	usedBytes: number;
	/** `null` when the plan has no cap. */
	limitBytes: number | null;
	periodStart: string;
	periodEnd: string;
	checkedAt: string;
}

export interface BandwidthKv {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface ProxyAccountApi {
	/** Base of the provider's v2 API, e.g. `https://<provider>/api/v2`. */
	baseUrl: string;
	apiKey: string;
	fetch: FetchLike;
}

const getJson = async (api: ProxyAccountApi, path: string): Promise<unknown> => {
	const response = await api.fetch(`${api.baseUrl.replace(/\/+$/u, "")}/${path}`, {
		headers: { authorization: `Token ${api.apiKey}` },
	});
	if (!response.ok) {
		throw new Error(`proxy account API ${path.split("?")[0]} responded ${response.status}`);
	}
	return response.json();
};

type Subscription = { plan: number; start_date: string; end_date: string };
type Plan = { id: number; status: string; bandwidth_limit: number };
type Aggregate = { bandwidth_total: number };

/** Reads the current period's usage and cap from the provider. */
export const readProxyBandwidth = async (api: ProxyAccountApi, now: Date): Promise<BandwidthSnapshot> => {
	const subscription = (await getJson(api, "subscription/")) as Subscription;
	const plans = (await getJson(api, "subscription/plan/")) as { results: Plan[] };
	const plan = plans.results.find((candidate) => candidate.id === subscription.plan);
	if (plan === undefined) {
		throw new Error(`proxy account API: active plan ${subscription.plan} not found`);
	}
	// `timestamp__lte` may not pass the period end; the period start is within the 90-day window.
	const until = new Date(Math.min(now.getTime(), Date.parse(subscription.end_date))).toISOString();
	const query = new URLSearchParams({ timestamp__gte: subscription.start_date, timestamp__lte: until });
	const stats = (await getJson(api, `stats/aggregate/?${query}`)) as Aggregate;
	return {
		usedBytes: stats.bandwidth_total,
		limitBytes: plan.bandwidth_limit > 0 ? plan.bandwidth_limit * BYTES_PER_GB : null,
		periodStart: subscription.start_date,
		periodEnd: subscription.end_date,
		checkedAt: now.toISOString(),
	};
};

const usageRatio = (snapshot: BandwidthSnapshot): number =>
	snapshot.limitBytes === null ? 0 : snapshot.usedBytes / snapshot.limitBytes;

export interface RefreshDeps {
	kv: BandwidthKv;
	api: ProxyAccountApi;
	now(): Date;
	log: Pick<Console, "info" | "warn" | "error">;
	/**
	 * Called with the highest threshold (`WARN_RATIO` / `STOP_RATIO`) usage has reached — on
	 * every run while it stays there; the ops alert dedupes per threshold per period. Must not
	 * throw (`alertProxyBandwidth` never does).
	 */
	onThreshold?(threshold: number, snapshot: BandwidthSnapshot, ratio: number): Promise<unknown>;
}

/** The cron step: fetch, store for the engines, and log/alert against the thresholds. */
export const refreshProxyBandwidth = async (deps: RefreshDeps): Promise<BandwidthSnapshot> => {
	const snapshot = await readProxyBandwidth(deps.api, deps.now());
	await deps.kv.put(PROXY_BANDWIDTH_KEY, JSON.stringify(snapshot), { expirationTtl: SNAPSHOT_TTL_SECONDS });
	const ratio = usageRatio(snapshot);
	const detail = { ...snapshot, ratio: Number(ratio.toFixed(4)) };
	if (ratio >= STOP_RATIO) {
		deps.log.error("proxy_bandwidth_exhausted", detail);
		await deps.onThreshold?.(STOP_RATIO, snapshot, ratio);
	} else if (ratio >= WARN_RATIO) {
		deps.log.warn("proxy_bandwidth_high", detail);
		await deps.onThreshold?.(WARN_RATIO, snapshot, ratio);
	} else {
		deps.log.info("proxy_bandwidth", detail);
	}
	return snapshot;
};

/**
 * Why the proxy engines should refuse right now, or `undefined` to proceed. Missing, unreadable
 * or out-of-period snapshots never block.
 */
export const proxyBandwidthRefusal = async (kv: BandwidthKv, now: Date): Promise<string | undefined> => {
	const raw = await kv.get(PROXY_BANDWIDTH_KEY).catch(() => null);
	if (raw === null) {
		return undefined;
	}
	let snapshot: BandwidthSnapshot;
	try {
		snapshot = JSON.parse(raw) as BandwidthSnapshot;
	} catch {
		return undefined;
	}
	if (now.getTime() >= Date.parse(snapshot.periodEnd) || usageRatio(snapshot) < STOP_RATIO) {
		return undefined;
	}
	return `the egress proxy's monthly bandwidth is used up until ${snapshot.periodEnd}`;
};
