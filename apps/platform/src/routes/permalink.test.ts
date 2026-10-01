import { describe, expect, it } from "vitest";

import { permalinkRoutes, permalinkTarget } from "./permalink";

describe("permalinkTarget", () => {
	it("takes everything after the first slash, query included", () => {
		expect(permalinkTarget("https://p.dev/https://example.com/a/b?x=1&y=2")).toBe("https://example.com/a/b?x=1&y=2");
		expect(permalinkTarget("https://p.dev/http://example.com")).toBe("http://example.com");
	});

	it("repairs a collapsed double slash and the scheme's case", () => {
		expect(permalinkTarget("https://p.dev/HTTPS:/example.com/a")).toBe("https://example.com/a");
	});

	it("ignores other paths", () => {
		expect(permalinkTarget("https://p.dev/dashboard")).toBeUndefined();
		expect(permalinkTarget("https://p.dev/v1/scrape")).toBeUndefined();
		expect(permalinkTarget("https://p.dev/httpsfoo")).toBeUndefined();
	});
});

const harness = (reply: (request: Request) => Response) => {
	const seen: { url: string; headers: Headers; body: unknown }[] = [];
	const app = permalinkRoutes(async (request) => {
		seen.push({ url: request.url, headers: request.headers, body: await request.clone().json() });
		return reply(request);
	});
	app.get("*", (c) => c.text("fallthrough", 404));
	return { app, seen };
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("permalink route", () => {
	it("serves the demo as text/markdown without a key", async () => {
		const { app, seen } = harness(() => json({ markdown: "# Hi", engine: "fetch", truncated: false }));

		const response = await app.request("https://p.dev/https://example.com/a?q=1", {
			headers: { "cf-connecting-ip": "203.0.113.7" },
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
		expect(response.headers.get("x-webforai-engine")).toBe("fetch");
		expect(response.headers.get("x-webforai-truncated")).toBe("false");
		expect(response.headers.get("cache-control")).toContain("public");
		expect(await response.text()).toBe("# Hi");
		expect(seen[0]?.url).toBe("https://p.dev/v1/demo/scrape");
		expect(seen[0]?.body).toEqual({ url: "https://example.com/a?q=1" });
		expect(seen[0]?.headers.get("cf-connecting-ip")).toBe("203.0.113.7");
	});

	it("runs a billed /v1/scrape with the caller's key and never caches publicly", async () => {
		const { app, seen } = harness(() => json({ markdown: "full", engine: "browser", credits: 2 }));

		const response = await app.request("https://p.dev/https://example.com", {
			headers: { authorization: "Bearer wfa_x" },
		});

		expect(await response.text()).toBe("full");
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(response.headers.get("x-webforai-credits")).toBe("2");
		expect(seen[0]?.url).toBe("https://p.dev/v1/scrape");
		expect(seen[0]?.headers.get("authorization")).toBe("Bearer wfa_x");
	});

	it("turns an error envelope into one plain-text line and keeps Retry-After", async () => {
		const { app } = harness(() =>
			json({ error: { code: "rate_limited", message: "Slow down." } }, 429, { "retry-after": "60" }),
		);

		const response = await app.request("https://p.dev/https://example.com");

		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("60");
		expect(await response.text()).toBe("rate_limited: Slow down.\n");
	});

	it("passes other paths through untouched", async () => {
		const { app, seen } = harness(() => json({}));
		expect((await app.request("https://p.dev/dashboard")).status).toBe(404);
		expect(seen).toEqual([]);
	});

	it("refuses an over-long target before dispatching", async () => {
		const { app, seen } = harness(() => json({}));
		const response = await app.request(`https://p.dev/https://example.com/${"a".repeat(3000)}`);
		expect(response.status).toBe(400);
		expect(seen).toEqual([]);
	});
});
