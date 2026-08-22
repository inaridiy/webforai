import { describe, expect, it } from "vitest";
import { createPlatformClient } from "./client.js";
import { PlatformApiError } from "./error.js";
import type { FetchLike, FetchRequestInit, FetchResponseLike } from "./fetch.js";
import { isStoredPageStub } from "./types.js";

/** Records every request and answers from a scripted queue (or a router function). */
const stubFetch = (
	handler: (url: string, init?: FetchRequestInit) => FetchResponseLike | Promise<FetchResponseLike>,
) => {
	const calls: { url: string; init?: FetchRequestInit }[] = [];
	const impl: FetchLike = (url, init) => {
		calls.push({ url, init });
		return Promise.resolve(handler(url, init));
	};
	return { impl, calls };
};

const json = (body: unknown, init?: ResponseInit) =>
	new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

const SCRAPE_OK = {
	url: "https://example.com/",
	engine: "fetch",
	markdown: "# Example",
	metadata: { title: "Example" },
	credits: 1,
};

describe("createPlatformClient", () => {
	it("POSTs a scrape with bearer auth against the default host", async () => {
		const { impl, calls } = stubFetch(() => json(SCRAPE_OK));
		const client = createPlatformClient({ apiKey: "wfa_test", fetch: impl });

		const result = await client.scrape({ url: "https://example.com", engine: "fetch" });

		expect(result.markdown).toBe("# Example");
		expect(calls[0]?.url).toBe("https://platform.webforai.dev/v1/scrape");
		const headers = calls[0]?.init?.headers as Record<string, string>;
		expect(headers.authorization).toBe("Bearer wfa_test");
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ url: "https://example.com", engine: "fetch" });
	});

	it("respects a custom baseUrl (trailing slash tolerated)", async () => {
		const { impl, calls } = stubFetch(() => json(SCRAPE_OK));
		const client = createPlatformClient({ apiKey: "k", baseUrl: "https://self.example/", fetch: impl });

		await client.scrape({ url: "https://example.com" });

		expect(calls[0]?.url).toBe("https://self.example/v1/scrape");
	});

	it("accepts a minimal structural fetch — no Response class, service-binding style", async () => {
		// Nothing DOM-shaped: exactly the FetchResponseLike surface, as a plain object. This is
		// what a wrapped Cloudflare service binding or a bespoke edge runtime can look like.
		const impl: FetchLike = (_url, _init) =>
			Promise.resolve({
				ok: true,
				status: 200,
				headers: { get: () => null },
				json: () => Promise.resolve(SCRAPE_OK),
			});
		const client = createPlatformClient({ apiKey: "k", fetch: impl });

		const result = await client.scrape({ url: "https://example.com" });

		expect(result.credits).toBe(1);
	});

	it("sends async: true for scrapeAsync", async () => {
		const { impl, calls } = stubFetch(() => json({ jobId: "job_1" }, { status: 202 }));
		const client = createPlatformClient({ apiKey: "k", fetch: impl });

		const ref = await client.scrapeAsync({ url: "https://example.com" });

		expect(ref.jobId).toBe("job_1");
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ url: "https://example.com", async: true });
	});

	it("refuses authorized calls without an API key, before any network I/O", async () => {
		const { impl, calls } = stubFetch(() => json(SCRAPE_OK));
		const client = createPlatformClient({ fetch: impl });

		await expect(client.scrape({ url: "https://example.com" })).rejects.toMatchObject({
			code: "missing_api_key",
		});
		expect(calls).toHaveLength(0);
	});

	it("demoScrape works without a key and sends no Authorization header", async () => {
		const { impl, calls } = stubFetch(() =>
			json({ url: "https://example.com", region: "auto", markdown: "# hi", truncated: false, metadata: {} }),
		);
		const client = createPlatformClient({ fetch: impl });

		const demo = await client.demoScrape({ url: "https://example.com" });

		expect(demo.truncated).toBe(false);
		expect(calls[0]?.url).toBe("https://platform.webforai.dev/v1/demo/scrape");
		const headers = calls[0]?.init?.headers as Record<string, string>;
		expect(headers.authorization).toBeUndefined();
	});

	it("maps the error envelope to PlatformApiError with code, status and retryAfter", async () => {
		const { impl } = stubFetch(() =>
			json(
				{ error: { code: "rate_limited", message: "slow down", retryAfter: 600 } },
				{ status: 429, headers: { "retry-after": "600" } },
			),
		);
		const client = createPlatformClient({ fetch: impl });

		const error = await client.demoScrape({ url: "https://example.com" }).catch((cause: unknown) => cause);

		expect(error).toBeInstanceOf(PlatformApiError);
		expect(error).toMatchObject({ code: "rate_limited", status: 429, retryAfter: 600, message: "slow down" });
	});

	it("turns a non-JSON error page into invalid_response (wrong baseUrl symptom)", async () => {
		const { impl } = stubFetch(() => new Response("<!doctype html>", { status: 404 }));
		const client = createPlatformClient({ apiKey: "k", fetch: impl });

		await expect(client.getJob("job_x")).rejects.toMatchObject({ code: "invalid_response", status: 404 });
	});

	it("waitForJob polls until a terminal status and reports each poll", async () => {
		const statuses = ["queued", "running", "completed"];
		let call = 0;
		const { impl } = stubFetch(() =>
			json({
				jobId: "job_1",
				type: "batch",
				status: statuses[call++],
				total: 2,
				completed: call,
				failed: 0,
				credits: call,
				expiresAt: "2026-08-29T00:00:00Z",
			}),
		);
		const client = createPlatformClient({ apiKey: "k", fetch: impl });
		const seen: string[] = [];

		const done = await client.waitForJob("job_1", { pollIntervalMs: 1, onStatus: (s) => seen.push(s.status) });

		expect(done.status).toBe("completed");
		expect(seen).toEqual(["queued", "running", "completed"]);
	});

	it("waitForJob times out with poll_timeout instead of hanging", async () => {
		const { impl } = stubFetch(() =>
			json({
				jobId: "job_1",
				type: "batch",
				status: "running",
				total: 1,
				completed: 0,
				failed: 0,
				credits: 0,
				expiresAt: "2026-08-29T00:00:00Z",
			}),
		);
		const client = createPlatformClient({ apiKey: "k", fetch: impl });

		await expect(client.waitForJob("job_1", { pollIntervalMs: 5, timeoutMs: 12 })).rejects.toMatchObject({
			code: "poll_timeout",
		});
	});

	it("jobResults follows the cursor and resolves resultUrl stubs to full pages", async () => {
		const page1 = {
			jobId: "job_1",
			status: "completed",
			results: [
				{ status: "ok", ...SCRAPE_OK },
				{
					status: "ok",
					url: "https://big.example/",
					engine: "fetch",
					credits: 1,
					resultUrl: "https://r2.example/spilled",
				},
			],
			cursor: "next",
		};
		const page2 = {
			jobId: "job_1",
			status: "completed",
			results: [
				{
					status: "error",
					url: "https://bad.example/",
					engine: "fetch",
					error: { code: "fetch_failed", message: "502" },
				},
			],
		};
		const spilled = {
			status: "ok",
			url: "https://big.example/",
			engine: "fetch",
			markdown: "# big",
			metadata: {},
			credits: 1,
		};
		const { impl, calls } = stubFetch((url) => {
			if (url.includes("cursor=next")) {
				return json(page2);
			}
			if (url.includes("/results")) {
				return json(page1);
			}
			return json(spilled);
		});
		const client = createPlatformClient({ apiKey: "k", fetch: impl });

		const items = [];
		for await (const item of client.jobResults("job_1")) {
			items.push(item);
		}

		expect(items).toHaveLength(3);
		expect(items[1]).toMatchObject({ markdown: "# big" });
		expect(items[2]).toMatchObject({ status: "error" });
		expect(items.some((item) => isStoredPageStub(item))).toBe(false);
		// The stub download must be a bare GET (signed URL), not an authorized API call.
		const stubCall = calls.find((c) => c.url === "https://r2.example/spilled");
		expect(stubCall?.init?.headers).toBeUndefined();
	});

	it("URL-encodes job ids", async () => {
		const { impl, calls } = stubFetch(() =>
			json({
				jobId: "a/b",
				type: "batch",
				status: "completed",
				total: 0,
				completed: 0,
				failed: 0,
				credits: 0,
				expiresAt: "",
			}),
		);
		const client = createPlatformClient({ apiKey: "k", fetch: impl });

		await client.getJob("a/b");

		expect(calls[0]?.url).toBe("https://platform.webforai.dev/v1/jobs/a%2Fb");
	});
});
