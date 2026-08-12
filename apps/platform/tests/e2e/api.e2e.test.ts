import { beforeAll, describe, expect, it } from "vitest";

import { BASE_URL } from "./config";
import { type Account, api, bearer, createApiKey, pollJob, signUp, uniqueEmail } from "./helpers";

/**
 * End-to-end API tests against the real running Worker (real D1/KV/R2 via workerd, real webforai
 * conversion, real network for the `fetch` engine). No mocks.
 */

describe("health", () => {
	it("returns ok", async () => {
		const res = await api<{ ok: boolean }>("/health");
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
	});
});

describe("scrape (sync, fetch engine)", () => {
	let account: Account;
	let key: string;

	beforeAll(async () => {
		account = await signUp();
		key = await createApiKey(account);
	});

	it("signup → key → scrape returns markdown + 1 credit", async () => {
		const res = await api<{ markdown: string; metadata: Record<string, unknown>; credits: number }>("/v1/scrape", {
			method: "POST",
			headers: bearer(key),
			json: { url: "https://example.com/" },
		});
		expect(res.status).toBe(200);
		expect(res.body.markdown).toContain("Example Domain");
		expect(res.body.credits).toBe(1);
		expect(res.body.metadata).toBeTruthy();
	});

	it("rejects a missing key with 401", async () => {
		const res = await api("/v1/scrape", { method: "POST", json: { url: "https://example.com/" } });
		expect(res.status).toBe(401);
	});

	it("rejects an invalid key with 401", async () => {
		const res = await api("/v1/scrape", {
			method: "POST",
			headers: bearer("wfa_x"),
			json: { url: "https://example.com/" },
		});
		expect(res.status).toBe(401);
	});

	it("rejects screenshot:true on the fetch engine with 400", async () => {
		const res = await api<{ error: { code: string } }>("/v1/scrape", {
			method: "POST",
			headers: bearer(key),
			json: { url: "https://example.com/", screenshot: true },
		});
		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe("invalid_request");
	});

	it("rejects an empty body with 400", async () => {
		const res = await api("/v1/scrape", { method: "POST", headers: bearer(key), json: {} });
		expect(res.status).toBe(400);
	});

	it("rejects an SSRF target with 400", async () => {
		const res = await api<{ error: { code: string } }>("/v1/scrape", {
			method: "POST",
			headers: bearer(key),
			json: { url: "http://169.254.169.254/" },
		});
		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe("invalid_url");
	});
});

describe("batch (async job on Workflows)", () => {
	it("submits 2 URLs → 202, completes, and returns 2 markdown results", async () => {
		const account = await signUp();
		const key = await createApiKey(account);

		const submit = await api<{ jobId: string }>("/v1/batch", {
			method: "POST",
			headers: bearer(key),
			json: { urls: ["https://example.com/", "https://www.iana.org/help/example-domains"] },
		});
		expect(submit.status).toBe(202);
		expect(submit.body.jobId).toMatch(/^job_/);

		const final = await pollJob(submit.body.jobId, key, 60_000);
		expect(final.status).toBe("completed");
		expect(final.total).toBe(2);
		expect(final.completed).toBe(2);

		const results = await api<{ results: Array<{ status: string; markdown?: string }> }>(
			`/v1/jobs/${submit.body.jobId}/results`,
			{ headers: bearer(key) },
		);
		expect(results.status).toBe(200);
		expect(results.body.results).toHaveLength(2);
		for (const r of results.body.results) {
			expect(r.status).toBe("ok");
			expect(r.markdown && r.markdown.length).toBeGreaterThan(0);
		}
	});
});

describe("crawl (async job on Workflows)", () => {
	it("crawls with maxDepth 1 / limit 3 and completes with ≥1 result", async () => {
		const account = await signUp();
		const key = await createApiKey(account);

		const submit = await api<{ jobId: string }>("/v1/crawl", {
			method: "POST",
			headers: bearer(key),
			json: { url: "https://www.iana.org/help/example-domains", maxDepth: 1, limit: 3 },
		});
		expect(submit.status).toBe(202);

		const final = await pollJob(submit.body.jobId, key, 60_000);
		expect(final.status).toBe("completed");
		expect(final.completed).toBeGreaterThanOrEqual(1);

		const results = await api<{ results: unknown[] }>(`/v1/jobs/${submit.body.jobId}/results`, {
			headers: bearer(key),
		});
		expect(results.body.results.length).toBeGreaterThanOrEqual(1);
	});
});

describe("dashboard usage", () => {
	it("reflects credits spent by the session's own scrape", async () => {
		const account = await signUp();
		const key = await createApiKey(account);

		const scrape = await api("/v1/scrape", { method: "POST", headers: bearer(key), json: { url: "https://example.com/" } });
		expect(scrape.status).toBe(200);

		const usage = await api<{ monthCredits: number; freeAllowance: number }>("/api/dashboard/usage", {
			headers: { cookie: account.cookie },
		});
		expect(usage.status).toBe(200);
		expect(usage.body.monthCredits).toBeGreaterThan(0);
		expect(usage.body.freeAllowance).toBeGreaterThan(0);
	});
});

describe("playground (session-authed, billed)", () => {
	it("signup → session cookie → playground scrape returns markdown + 1 credit", async () => {
		const account = await signUp();
		const res = await api<{ markdown: string; metadata: Record<string, unknown>; credits: number }>(
			"/api/dashboard/playground/scrape",
			{
				method: "POST",
				headers: { cookie: account.cookie },
				json: { url: "https://example.com/", engine: "fetch" },
			},
		);
		expect(res.status).toBe(200);
		expect(res.body.markdown).toContain("Example Domain");
		expect(res.body.credits).toBe(1);
		expect(res.body.metadata).toBeTruthy();
	});

	it("rejects an unauthenticated call with 401", async () => {
		const res = await api("/api/dashboard/playground/scrape", {
			method: "POST",
			json: { url: "https://example.com/", engine: "fetch" },
		});
		expect(res.status).toBe(401);
	});

	it("rejects screenshot:true on the fetch engine with 400", async () => {
		const account = await signUp();
		const res = await api<{ error: { code: string } }>("/api/dashboard/playground/scrape", {
			method: "POST",
			headers: { cookie: account.cookie },
			json: { url: "https://example.com/", engine: "fetch", screenshot: true },
		});
		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe("invalid_request");
	});
});

describe("demo rate limit", () => {
	/**
	 * The demo endpoint is public and keyless; `DEMO_IP_LIMIT = 5` per 10 min per IP.
	 *
	 * With (fake) Webshare creds set in the harness, `proxyEnabled` is true, so the limiter runs.
	 * The actual proxy fetch has no egress locally, so the *allowed* calls come back as an error
	 * (502/503) rather than 200 — that is expected and fine: the counter is incremented before the
	 * scrape runs, so what we assert is the limiter, not the proxy.
	 *
	 * The bucket key is the client IP. `demoClientIp` reads `cf-connecting-ip` first, and workerd
	 * populates that header in local dev (to the loopback), so `x-forwarded-for` alone is ignored
	 * and every client would share one saturated bucket. We therefore send a unique, per-run
	 * `cf-connecting-ip` to get a fresh per-IP bucket — the same header Cloudflare's edge sets (and
	 * that clients cannot spoof) in production.
	 */
	it("allows the first 5 (non-429) then returns 429 with Retry-After", async () => {
		const ip = `${100 + Math.floor(Math.random() * 100)}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
		const call = () =>
			api<{ error?: { code: string; retryAfter?: number } }>("/v1/demo/scrape", {
				method: "POST",
				headers: { "cf-connecting-ip": ip },
				json: { url: "https://example.com/" },
			});

		for (let i = 0; i < 5; i++) {
			const res = await call();
			expect(res.status, `demo call ${i + 1} should be allowed (non-429)`).not.toBe(429);
		}

		const limited = await call();
		expect(limited.status).toBe(429);
		expect(limited.headers.get("retry-after")).toBeTruthy();
		expect(limited.body.error?.code).toBe("rate_limited");
	});
});

describe("auth origin", () => {
	it("issues a session cookie and a wfa_ key for a fresh account", async () => {
		const account = await signUp(uniqueEmail("origin"));
		expect(account.cookie).toContain("better-auth");
		const key = await createApiKey(account);
		expect(key.startsWith("wfa_")).toBe(true);
		// Sanity: BASE_URL is what the harness pointed the Worker at.
		expect(BASE_URL).toMatch(/^http:\/\/localhost:/);
	});
});
