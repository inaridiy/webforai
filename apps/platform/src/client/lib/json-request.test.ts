import { describe, expect, it } from "vitest";
import { billingRedirectSchema, jobsSchema, usageSchema } from "./api-schemas";
import { requestJson } from "./json-request";

describe("dashboard JSON boundary", () => {
	it("represents a response stream failure as a retryable error", async () => {
		const fetcher: typeof fetch = async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.error(new Error("connection reset"));
					},
				}),
			);
		await expect(requestJson(fetcher, "/jobs", jobsSchema)).resolves.toMatchObject({ ok: false, status: 0 });
	});
	it.each([{}, { jobs: null }, { jobs: [null] }, { jobs: "unavailable" }])(
		"rejects malformed jobs: %j",
		async (body) => {
			const fetcher: typeof fetch = async () => Response.json(body);
			await expect(requestJson(fetcher, "/jobs", jobsSchema)).resolves.toMatchObject({ ok: false, status: 200 });
		},
	);
	it("accepts an actual empty list", async () => {
		const fetcher: typeof fetch = async () => Response.json({ jobs: [] });
		await expect(requestJson(fetcher, "/jobs", jobsSchema)).resolves.toEqual({ ok: true, value: { jobs: [] } });
	});
	it("keeps billing conflict messages instead of misreporting all conflicts as disabled billing", async () => {
		const fetcher: typeof fetch = async () =>
			Response.json(
				{
					error: { code: "no_customer", message: "No Stripe customer for this account." },
				},
				{ status: 409 },
			);
		await expect(requestJson(fetcher, "/checkout", billingRedirectSchema)).resolves.toEqual({
			ok: false,
			error: "No Stripe customer for this account.",
			status: 409,
		});
	});
	it("preserves the HTTP status of an HTML proxy error", async () => {
		const fetcher: typeof fetch = async () => new Response("<html>Unavailable</html>", { status: 503 });
		await expect(requestJson(fetcher, "/jobs", jobsSchema)).resolves.toMatchObject({ ok: false, status: 503 });
	});
	it("rejects incomplete usage and unsafe billing redirects", () => {
		expect(usageSchema.safeParse({ monthCredits: 0 }).success).toBe(false);
		expect(billingRedirectSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
		expect(billingRedirectSchema.safeParse({ url: "https://billing.stripe.com/session" }).success).toBe(true);
	});
});
