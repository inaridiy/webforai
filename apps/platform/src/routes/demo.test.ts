import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { ScrapeRequest, ScrapeSuccess } from "../core/types";
import {
	DEMO_GLOBAL_LIMIT,
	DEMO_GLOBAL_WINDOW_SECONDS,
	DEMO_IP_LIMIT,
	DEMO_IP_WINDOW_SECONDS,
	DEMO_MARKDOWN_LIMIT,
	type DemoDeps,
	type DemoKv,
	demoClientIp,
	demoGlobalKey,
	demoIpKey,
	demoRoutes,
	secondsUntilUtcMidnight,
} from "./demo";

/**
 * The demo endpoint is the only route a stranger can spend money on, so these tests pin the two
 * things that bound that spend — the windows and the fail-closed behaviour — plus the mounting
 * order that keeps the route reachable without an API key.
 *
 * No network and no Cloudflare: KV is a Map and the scrape step is injected.
 */

interface FakeKv extends DemoKv {
	store: Map<string, { value: string; expirationTtl?: number }>;
}

const fakeKv = (failOn?: "get" | "put"): FakeKv => {
	const store = new Map<string, { value: string; expirationTtl?: number }>();
	return {
		store,
		get: (key) =>
			failOn === "get" ? Promise.reject(new Error("KV down")) : Promise.resolve(store.get(key)?.value ?? null),
		put: (key, value, options) => {
			if (failOn === "put") {
				return Promise.reject(new Error("KV down"));
			}
			store.set(key, { value, expirationTtl: options?.expirationTtl });
			return Promise.resolve();
		},
	};
};

const NOW = new Date("2026-08-12T09:30:00.000Z");

const scrapeResult = (request: ScrapeRequest, markdown = "# Demo\n\nbody"): ScrapeSuccess => ({
	url: request.url,
	engine: request.engine,
	markdown,
	metadata: { title: "Demo page" },
	credits: 2,
});

const harness = (overrides: Partial<DemoDeps> = {}) => {
	const kv = overrides.kv ? (overrides.kv as FakeKv) : fakeKv();
	const requests: ScrapeRequest[] = [];
	const deps: DemoDeps = {
		kv,
		proxyEnabled: true,
		now: () => NOW,
		runScrape: (request) => {
			requests.push(request);
			return Promise.resolve(scrapeResult(request));
		},
		...overrides,
		...(overrides.kv ? { kv } : {}),
	};

	const app = new Hono<{ Bindings: Env }>();
	app.route(
		"/v1/demo",
		demoRoutes(() => deps),
	);
	return { app, kv, requests, deps };
};

const post = (
	app: Hono<{ Bindings: Env }>,
	body: unknown,
	headers: Record<string, string> = { "cf-connecting-ip": "203.0.113.7" },
) =>
	app.request(
		"/v1/demo/scrape",
		{ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) },
		{} as Env,
	);

const seedWindow = (kv: FakeKv, key: string, count: number, resetAt: number) => {
	kv.store.set(key, { value: JSON.stringify({ count, resetAt }) });
};

describe("demo scrape", () => {
	it("runs a proxy-fetch scrape with the requested region and no billing", async () => {
		const { app, requests } = harness();

		const response = await post(app, { url: "https://example.com/a", region: "jp" });
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(200);
		expect(requests).toEqual([
			{
				url: "https://example.com/a",
				engine: "proxy-fetch",
				screenshot: false,
				rehostImages: false,
				region: "jp",
				convert: {},
			},
		]);
		expect(body).toEqual({
			url: "https://example.com/a",
			region: "jp",
			markdown: "# Demo\n\nbody",
			truncated: false,
			title: "Demo page",
			metadata: { title: "Demo page" },
		});
	});

	it("defaults the region to auto", async () => {
		const { app, requests } = harness();
		await post(app, { url: "https://example.com/a" });
		expect(requests[0]?.region).toBe("auto");
	});

	it("truncates long markdown and says so", async () => {
		const long = "x".repeat(DEMO_MARKDOWN_LIMIT + 500);
		const { app } = harness({ runScrape: (request) => Promise.resolve(scrapeResult(request, long)) });

		const body = (await (await post(app, { url: "https://example.com/a" })).json()) as {
			markdown: string;
			truncated: boolean;
		};

		expect(body.truncated).toBe(true);
		expect(body.markdown).toHaveLength(DEMO_MARKDOWN_LIMIT);
	});

	it("rejects an unknown region, a bad URL and unknown keys", async () => {
		const { app } = harness();
		expect((await post(app, { url: "https://example.com/a", region: "mars" })).status).toBe(400);
		expect((await post(app, { url: "not a url" })).status).toBe(400);
		expect((await post(app, { url: "https://example.com/a", engine: "browser" })).status).toBe(400);
	});

	it("is 503 when the proxy is not configured, and costs no allowance", async () => {
		const { app, kv } = harness({ proxyEnabled: false });
		const response = await post(app, { url: "https://example.com/a" });

		expect(response.status).toBe(503);
		expect((await response.json()) as { error: { code: string } }).toMatchObject({
			error: { code: "engine_unavailable" },
		});
		expect(kv.store.size).toBe(0);
	});

	it("answers CORS preflight for a cross-origin docs site", async () => {
		const { app } = harness();
		const response = await app.request(
			"/v1/demo/scrape",
			{ method: "OPTIONS", headers: { origin: "https://webforai.dev", "access-control-request-method": "POST" } },
			{} as Env,
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		expect(response.headers.get("access-control-allow-methods")).toContain("POST");
	});
});

describe("demo rate limits", () => {
	it("allows the first five requests from one IP, then 429s with Retry-After", async () => {
		const { app, requests } = harness();

		for (let attempt = 0; attempt < DEMO_IP_LIMIT; attempt += 1) {
			expect((await post(app, { url: "https://example.com/a" })).status).toBe(200);
		}
		expect(requests).toHaveLength(DEMO_IP_LIMIT);

		const blocked = await post(app, { url: "https://example.com/a" });
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get("Retry-After")).toBe(String(DEMO_IP_WINDOW_SECONDS));
		expect((await blocked.json()) as unknown).toEqual({
			error: {
				code: "rate_limited",
				message: expect.stringContaining(String(DEMO_IP_LIMIT)),
				retryAfter: DEMO_IP_WINDOW_SECONDS,
			},
		});
		// The rejected request never reached the proxy.
		expect(requests).toHaveLength(DEMO_IP_LIMIT);
	});

	it("counts each IP separately and writes the window key and TTL", async () => {
		const { app, kv } = harness();

		await post(app, { url: "https://example.com/a" }, { "cf-connecting-ip": "203.0.113.7" });
		await post(app, { url: "https://example.com/a" }, { "cf-connecting-ip": "203.0.113.8" });

		const first = kv.store.get(demoIpKey("203.0.113.7"));
		expect(first?.expirationTtl).toBe(DEMO_IP_WINDOW_SECONDS);
		expect(JSON.parse(first?.value ?? "{}")).toEqual({
			count: 1,
			resetAt: NOW.getTime() + DEMO_IP_WINDOW_SECONDS * 1000,
		});
		expect(JSON.parse(kv.store.get(demoIpKey("203.0.113.8"))?.value ?? "{}")).toMatchObject({ count: 1 });

		const global = kv.store.get(demoGlobalKey(NOW));
		expect(demoGlobalKey(NOW)).toBe("demo:global:2026-08-12");
		// The daily window ends at the UTC midnight the key names — 14h30m after 09:30Z.
		expect(secondsUntilUtcMidnight(NOW)).toBe(14 * 3600 + 30 * 60);
		expect(secondsUntilUtcMidnight(new Date("2026-08-12T00:00:00.000Z"))).toBe(DEMO_GLOBAL_WINDOW_SECONDS);
		expect(global?.expirationTtl).toBe(secondsUntilUtcMidnight(NOW));
		expect(JSON.parse(global?.value ?? "{}")).toEqual({
			count: 2,
			resetAt: Date.parse("2026-08-13T00:00:00.000Z"),
		});
	});

	it("keeps the original reset time as the window fills, so it cannot be slid forward", async () => {
		const { app, kv } = harness();
		seedWindow(kv, demoIpKey("203.0.113.7"), 2, NOW.getTime() + 120_000);

		await post(app, { url: "https://example.com/a" });

		const stored = JSON.parse(kv.store.get(demoIpKey("203.0.113.7"))?.value ?? "{}") as Record<string, number>;
		expect(stored).toEqual({ count: 3, resetAt: NOW.getTime() + 120_000 });
		expect(kv.store.get(demoIpKey("203.0.113.7"))?.expirationTtl).toBe(120);
	});

	it("starts a fresh window once the stored one has expired", async () => {
		const { app, kv } = harness();
		seedWindow(kv, demoIpKey("203.0.113.7"), DEMO_IP_LIMIT, NOW.getTime() - 1);

		expect((await post(app, { url: "https://example.com/a" })).status).toBe(200);
		expect(JSON.parse(kv.store.get(demoIpKey("203.0.113.7"))?.value ?? "{}")).toEqual({
			count: 1,
			resetAt: NOW.getTime() + DEMO_IP_WINDOW_SECONDS * 1000,
		});
	});

	it("blocks on the global daily cap even for an IP with allowance left", async () => {
		const { app, kv, requests } = harness();
		const resetAt = NOW.getTime() + 3600_000;
		seedWindow(kv, demoGlobalKey(NOW), DEMO_GLOBAL_LIMIT, resetAt);

		const response = await post(app, { url: "https://example.com/a" });

		expect(response.status).toBe(429);
		expect((await response.json()) as { error: { retryAfter: number } }).toMatchObject({
			error: { code: "rate_limited", retryAfter: 3600 },
		});
		expect(requests).toHaveLength(0);
		// A request the global cap rejected must not burn the caller's per-IP allowance.
		expect(kv.store.has(demoIpKey("203.0.113.7"))).toBe(false);
	});

	it("allows the request that reaches the global cap and blocks the next one", async () => {
		const { app, kv } = harness();
		seedWindow(kv, demoGlobalKey(NOW), DEMO_GLOBAL_LIMIT - 1, NOW.getTime() + 3600_000);

		expect((await post(app, { url: "https://example.com/a" })).status).toBe(200);
		expect((await post(app, { url: "https://example.com/a" }, { "cf-connecting-ip": "198.51.100.4" })).status).toBe(
			429,
		);
	});

	it("denies rather than allows when KV cannot be read or written", async () => {
		for (const failure of ["get", "put"] as const) {
			const { app, requests } = harness({ kv: fakeKv(failure) });
			const response = await post(app, { url: "https://example.com/a" });

			expect(response.status).toBe(429);
			expect((await response.json()) as { error: { code: string } }).toMatchObject({
				error: { code: "rate_limited" },
			});
			expect(requests).toHaveLength(0);
		}
	});

	it("buckets unidentifiable clients together instead of exempting them", () => {
		expect(demoClientIp(new Headers({ "cf-connecting-ip": "203.0.113.7" }))).toBe("203.0.113.7");
		expect(demoClientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
		expect(demoClientIp(new Headers())).toBe("unknown");
		expect(demoIpKey("203.0.113.7")).toBe("demo:ip:203.0.113.7");
	});
});

describe("demo mounting order", () => {
	/** Mirrors `src/index.ts`: the demo app is registered before the `/v1/*` API-key guard. */
	const appWithGuard = () => {
		const { app, requests } = harness();
		app.use("/v1/*", (c) =>
			Promise.resolve(c.json({ error: { code: "invalid_api_key", message: "Missing API key." } }, 401)),
		);
		app.post("/v1/scrape", (c) => c.json({ ok: true }));
		return { app, requests };
	};

	it("serves the demo without an Authorization header", async () => {
		const { app, requests } = appWithGuard();
		const response = await post(app, { url: "https://example.com/a" });

		expect(response.status).toBe(200);
		expect(requests).toHaveLength(1);
	});

	it("still guards the rest of /v1", async () => {
		const { app } = appWithGuard();
		const response = await app.request("/v1/scrape", { method: "POST", body: "{}" }, {} as Env);
		expect(response.status).toBe(401);
	});
});
