import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PlatformError } from "../core/types";
import { onPlatformError, toErrorResponse } from "./errors";

describe("API error responses", () => {
	it("preserves actionable platform errors", () => {
		expect(toErrorResponse(new PlatformError("payment_required", "Free allowance exhausted.", 402))).toEqual({
			status: 402,
			body: { error: { code: "payment_required", message: "Free allowance exhausted." } },
		});
	});

	it("does not expose database queries or configuration values", () => {
		const detail = "secret database query";
		const invalidConfig = z
			.string()
			.refine(() => false, detail)
			.safeParse("secret");
		if (invalidConfig.success) throw new Error("expected invalid config");
		for (const error of [new Error(detail), detail, invalidConfig.error]) {
			const response = toErrorResponse(error);
			expect(response.status).toBe(500);
			expect(JSON.stringify(response.body)).not.toContain(detail);
		}
	});

	it("logs unexpected failures while returning the public JSON envelope", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			const app = new Hono();
			app.onError(onPlatformError);
			const failure = new Error("private upstream credentials");
			app.get("/test", () => {
				throw failure;
			});
			const response = await app.request("/test");
			expect(response.status).toBe(500);
			expect(await response.json()).toMatchObject({ error: { code: "internal_error" } });
			expect(log).toHaveBeenCalledWith("platform_request_failed", { path: "/test", error: failure });
		} finally {
			log.mockRestore();
		}
	});
});
