import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
	MAX_REQUEST_BODY_BYTES,
	WORKER_SECURITY_HEADERS,
	requestBodyLimit,
	requireSameOrigin,
	securityHeaders,
} from "./security";

const ORIGIN = "https://platform.example.com";

/** A miniature of the composition root's middleware order. */
const app = () => {
	const hono = new Hono();
	hono.use("*", securityHeaders);
	hono.use("/api/*", requestBodyLimit);
	hono.use("/v1/*", requestBodyLimit);
	hono.use(
		"/api/dashboard/*",
		requireSameOrigin(() => ORIGIN),
	);
	hono.get("/api/dashboard/usage", (c) => c.json({ ok: true }));
	hono.post("/api/dashboard/account/delete", (c) => c.json({ deleted: true }));
	hono.post("/api/auth/sign-in", (c) => c.json({ ok: true }));
	hono.post("/v1/scrape", async (c) => c.json({ size: (await c.req.text()).length }));
	hono.get("/artifacts/x", (c) => {
		c.header("referrer-policy", "no-referrer");
		return c.body("img");
	});
	hono.get("/proxied", () => {
		// `fetch()` responses carry immutable headers.
		const response = Response.redirect("https://example.com/", 302);
		return response;
	});
	return hono;
};

describe("security headers", () => {
	it("adds the baseline to Worker responses", async () => {
		const response = await app().request("/api/dashboard/usage");
		for (const [name, value] of Object.entries(WORKER_SECURITY_HEADERS)) {
			expect(response.headers.get(name)).toBe(value);
		}
	});

	it("keeps a route's own stricter choice", async () => {
		const response = await app().request("/artifacts/x");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("copies immutable responses rather than failing", async () => {
		const response = await app().request("/proxied");
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://example.com/");
		expect(response.headers.get("x-frame-options")).toBe("DENY");
	});
});

describe("request body limit", () => {
	it("accepts bodies up to the cap and refuses larger ones with 413", async () => {
		const ok = await app().request("/v1/scrape", { method: "POST", body: "a".repeat(MAX_REQUEST_BODY_BYTES) });
		expect(ok.status).toBe(200);

		const tooLarge = await app().request("/v1/scrape", {
			method: "POST",
			body: "a".repeat(MAX_REQUEST_BODY_BYTES + 1),
			headers: { "content-length": String(MAX_REQUEST_BODY_BYTES + 1) },
		});
		expect(tooLarge.status).toBe(413);
		expect(await tooLarge.json()).toEqual({
			error: { code: "payload_too_large", message: `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.` },
		});
	});

	it("covers /api as well", async () => {
		const response = await app().request("/api/auth/sign-in", {
			method: "POST",
			body: "a".repeat(MAX_REQUEST_BODY_BYTES + 1),
			headers: { "content-length": String(MAX_REQUEST_BODY_BYTES + 1) },
		});
		expect(response.status).toBe(413);
	});
});

describe("dashboard origin check", () => {
	const post = (headers: Record<string, string>) =>
		app().request("/api/dashboard/account/delete", { method: "POST", headers });

	it("lets same-origin state changes through", async () => {
		const response = await post({ origin: ORIGIN });
		expect(response.status).toBe(200);
	});

	it.each([
		["a missing Origin", {}],
		["a foreign Origin", { origin: "https://evil.example" }],
		["an opaque Origin", { origin: "null" }],
		["a look-alike Origin", { origin: `${ORIGIN}.evil.example` }],
		["a different scheme", { origin: "http://platform.example.com" }],
	])("refuses %s with 403 forbidden_origin", async (_label, headers) => {
		const response = await post(headers);
		expect(response.status).toBe(403);
		expect(((await response.json()) as { error: { code: string } }).error.code).toBe("forbidden_origin");
	});

	it("leaves safe methods and other prefixes alone", async () => {
		expect((await app().request("/api/dashboard/usage")).status).toBe(200);
		expect((await app().request("/api/auth/sign-in", { method: "POST" })).status).toBe(200);
		expect((await app().request("/v1/scrape", { method: "POST", body: "{}" })).status).toBe(200);
	});
});
