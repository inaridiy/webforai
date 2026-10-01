import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { type RateLimiter, type Tier, rateLimitedMessage } from "../ops/limits";
import type { Auth } from "./auth";
import { type ApiKeyGateDeps, type AuthVariables, requireApiKey } from "./middleware";

/**
 * The `/v1` gate: key verification (Better Auth, faked) then the per-account limit on the
 * tier's Rate Limiting binding (faked). No D1, no Cloudflare.
 */

const DASHBOARD = "https://platform.webforai.dev/dashboard";

const fakeAuth = (keys: Record<string, { id: string; referenceId: string }>, errorCode?: string): Auth =>
	({
		api: {
			verifyApiKey: ({ body }: { body: { key: string } }) => {
				const key = keys[body.key];
				return Promise.resolve(
					key ? { valid: true, key } : { valid: false, key: null, error: errorCode ? { code: errorCode } : null },
				);
			},
		},
	}) as unknown as Auth;

const limiter = (limit: number) => {
	const keys: string[] = [];
	let used = 0;
	const value: RateLimiter = {
		limit: ({ key }) => {
			keys.push(key);
			used += 1;
			return Promise.resolve({ success: used <= limit });
		},
	};
	return { value, keys };
};

const harness = (options: {
	tiers?: Record<string, Tier>;
	limiters?: Partial<Record<Tier, RateLimiter>>;
	errorCode?: string;
}) => {
	const auth = fakeAuth(
		{ wfa_alice: { id: "key_a", referenceId: "user_alice" }, wfa_alice2: { id: "key_a2", referenceId: "user_alice" } },
		options.errorCode,
	);
	const deps: ApiKeyGateDeps = {
		tierOf: (userId) => Promise.resolve(options.tiers?.[userId] ?? "free"),
		limiter: (tier) => options.limiters?.[tier],
		dashboardUrl: DASHBOARD,
	};
	const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
	app.use(
		"/v1/*",
		requireApiKey(auth, () => deps),
	);
	app.get("/v1/whoami", (c) => c.json({ userId: c.get("apiKeyUserId"), tier: c.get("apiKeyTier") }));
	const call = (key?: string) =>
		app.request("/v1/whoami", key ? { headers: { authorization: `Bearer ${key}` } } : {}, {} as Env);
	return { call };
};

describe("requireApiKey", () => {
	it("points a caller without a key, or with a bad one, at the dashboard", async () => {
		const { call } = harness({});
		const missing = await call();
		expect(missing.status).toBe(401);
		expect(await missing.json()).toEqual({
			error: { code: "invalid_api_key", message: `Missing API key. Create a key at ${DASHBOARD}` },
		});
		const invalid = await call("wfa_nope");
		expect(invalid.status).toBe(401);
		expect(((await invalid.json()) as { error: { message: string } }).error.message).toBe(
			`Invalid API key. Create a key at ${DASHBOARD}`,
		);
	});

	it("passes the owner and tier through under the limit", async () => {
		const free = limiter(60);
		const { call } = harness({ limiters: { free: free.value } });
		const response = await call("wfa_alice");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ userId: "user_alice", tier: "free" });
		expect(free.keys).toEqual(["user_alice"]);
	});

	it("counts every key of an account together and 429s with Retry-After past the limit", async () => {
		const free = limiter(2);
		const { call } = harness({ limiters: { free: free.value } });
		expect((await call("wfa_alice")).status).toBe(200);
		expect((await call("wfa_alice2")).status).toBe(200);
		const limited = await call("wfa_alice");
		expect(limited.status).toBe(429);
		expect(limited.headers.get("retry-after")).toBe("60");
		expect(await limited.json()).toEqual({ error: { code: "rate_limited", message: rateLimitedMessage("free") } });
		expect(free.keys).toEqual(["user_alice", "user_alice", "user_alice"]);
	});

	it("uses the paid binding for an active subscription", async () => {
		const free = limiter(0);
		const paid = limiter(600);
		const { call } = harness({ tiers: { user_alice: "paid" }, limiters: { free: free.value, paid: paid.value } });
		const response = await call("wfa_alice");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ userId: "user_alice", tier: "paid" });
		expect(paid.keys).toEqual(["user_alice"]);
		expect(free.keys).toEqual([]);
	});

	it("runs without a limit when the deployment has no binding", async () => {
		const { call } = harness({});
		for (let i = 0; i < 5; i += 1) {
			expect((await call("wfa_alice")).status).toBe(200);
		}
	});

	it("still maps a key-level throttle from Better Auth to 429", async () => {
		const { call } = harness({ errorCode: "USAGE_EXCEEDED" });
		const response = await call("wfa_quota");
		expect(response.status).toBe(429);
		expect(((await response.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
	});
});
