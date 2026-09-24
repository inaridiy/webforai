import { describe, expect, it, vi } from "vitest";
import type { ArtifactStore } from "../artifacts/store";
import { parseRobotsTxt } from "../core/robots";
import { EscalationExhaustedError, type FetchedPage, PlatformError } from "../core/types";
import { type PageDeps, type RunPageParams, recordPageFailure, runPage } from "./page";
import { type PageCommit, pageCommitId } from "./page-accounting";
import type { PageArchive } from "./page-archive";
import { pageResultKey } from "./results";

const params: RunPageParams = {
	jobId: "job_1",
	userId: "user_1",
	index: 0,
	countsTowardsTotal: true,
	request: { url: "https://example.com", engine: "fetch", screenshot: false, rehostImages: false, convert: {} },
	scope: { origin: "https://example.com" },
};

const harness = () => {
	const pages = new Map<string, PageCommit>();
	const objects = new Map<string, PageArchive>();
	const kv = new Map<string, string>();
	const usage = new Map<string, number>();
	const counts = { succeeded: 0, failed: 0, total: 0, credits: 0 };
	const controls = { loseCommitResponse: false, failKv: false, failCommit: false };
	const fetch = vi.fn(
		async (): Promise<FetchedPage> => ({
			html: `<html><body><h1>Article</h1><p>Attempt ${fetch.mock.calls.length}</p><a href="/next-${fetch.mock.calls.length}">Next</a></body></html>`,
			url: "https://example.com",
			status: 200,
		}),
	);
	const artifacts: ArtifactStore = {
		putScreenshot: async () => "https://example.com/screenshot",
		putImage: async () => "https://example.com/image",
		putResult: async () => "https://example.com/result",
	};
	const deps: PageDeps = {
		scrape: { engines: { fetch, browser: fetch, "proxy-fetch": fetch, "proxy-browser": fetch }, artifacts },
		guard: vi.fn(async () => undefined),
		now: () => new Date("2026-09-06T00:00:00Z"),
		reportUsage: vi.fn(async () => undefined),
		results: {
			artifacts,
			kv: {
				get: async (key) => kv.get(key) ?? null,
				list: async () => ({ keys: [...kv.keys()].map((name) => ({ name })), list_complete: true }),
				put: async (key, value) => {
					if (controls.failKv) throw new Error("KV unavailable");
					kv.set(key, value);
				},
			},
		},
		archives: {
			put: async (_jobId, _index, value) => {
				const key = `attempt-${objects.size}`;
				objects.set(key, structuredClone(value));
				return key;
			},
			get: async (key) => {
				const value = objects.get(key);
				if (!value) throw new Error("Archive unavailable");
				return structuredClone(value);
			},
		},
		accounting: {
			get: async (id) => pages.get(id),
			hasPages: async (jobId) => [...pages.values()].some((page) => page.jobId === jobId),
			list: async (jobId, afterIndex, limit, createdAfter) =>
				[...pages.values()]
					.filter((page) => page.jobId === jobId && page.pageIndex > afterIndex && page.createdAt > createdAfter)
					.sort((a, b) => a.pageIndex - b.pageIndex)
					.slice(0, limit),
			commit: async ({ page, countsTowardsTotal }) => {
				if (controls.failCommit) throw new Error("D1 unavailable");
				const previous = pages.get(page.id);
				if (previous) return previous;
				// The same atomic first-writer contract as the D1 repository. Its actual SQL
				// rollback and concurrent commits are verified separately against real D1.
				pages.set(page.id, page);
				counts.succeeded += page.status === "ok" ? 1 : 0;
				counts.failed += page.status === "error" ? 1 : 0;
				counts.credits += page.credits;
				counts.total += countsTowardsTotal ? 1 : 0;
				if (page.status === "ok") usage.set(page.id, page.credits);
				if (controls.loseCommitResponse) throw new Error("Response lost after commit");
				return page;
			},
		},
	};
	return { deps, controls, fetch, pages, objects, kv, counts, usage };
};

describe("durable page execution", () => {
	it("recovers a lost commit response without refetching or charging twice", async () => {
		const state = harness();
		state.controls.loseCommitResponse = true;
		await expect(runPage(state.deps, params)).rejects.toThrow("Response lost after commit");
		expect(state.kv.size).toBe(0);
		// The quota may have been exhausted by the committed page; resuming publication
		// must still return the page that was already paid for.
		state.deps.guard = async () => {
			throw new PlatformError("payment_required", "No allowance", 402);
		};
		const result = await runPage(state.deps, params);
		expect(result).toMatchObject({ ok: true, credits: 1, links: ["https://example.com/next-1"] });
		expect(state.fetch).toHaveBeenCalledTimes(1);
		expect(state.counts).toEqual({ succeeded: 1, failed: 0, total: 1, credits: 1 });
		expect([...state.usage]).toEqual([[pageCommitId("job_1", 0), 1]]);
		expect(JSON.parse(state.kv.get(pageResultKey("job_1", 0)) ?? "null")).toMatchObject({ status: "ok", credits: 1 });
	});

	it("returns the same canonical outcome when concurrent attempts race", async () => {
		const state = harness();
		const [first, second] = await Promise.all([runPage(state.deps, params), runPage(state.deps, params)]);
		expect(first).toEqual(second);
		expect(state.pages.size).toBe(1);
		expect(state.counts).toEqual({ succeeded: 1, failed: 0, total: 1, credits: 1 });
		expect(state.usage.size).toBe(1);
	});

	it("retries KV publication from the archive and cannot overwrite success with a failure", async () => {
		const state = harness();
		state.controls.failKv = true;
		await expect(runPage(state.deps, params)).rejects.toThrow("KV unavailable");
		state.controls.failKv = false;
		expect(await recordPageFailure(state.deps, params, new Error("step retries exhausted"))).toMatchObject({
			ok: true,
		});
		expect(state.fetch).toHaveBeenCalledTimes(1);
		expect(state.counts.failed).toBe(0);
		expect(state.usage.size).toBe(1);
	});

	it("does not publish or bill when the commit fails before persistence", async () => {
		const state = harness();
		state.controls.failCommit = true;
		await expect(runPage(state.deps, params)).rejects.toThrow("D1 unavailable");
		expect(state.pages.size).toBe(0);
		expect(state.kv.size).toBe(0);
		expect(state.usage.size).toBe(0);
		state.controls.failCommit = false;
		expect(await runPage(state.deps, params)).toMatchObject({ ok: true });
		expect(state.counts.succeeded).toBe(1);
	});

	it("records an exhausted escalation as a failed page instead of handing it to step retries", async () => {
		const state = harness();
		state.fetch.mockRejectedValueOnce(
			new EscalationExhaustedError("fetch_failed", 'engine "fetch" failed; escalation to "browser" also failed', 502),
		);

		expect(await runPage(state.deps, params)).toMatchObject({ ok: false, credits: 0 });
		expect(state.counts).toMatchObject({ succeeded: 0, failed: 1, credits: 0 });
	});

	it("records a robots.txt-disallowed URL as a failed, unbilled page without fetching it", async () => {
		const state = harness();
		state.deps.scrape.robotsTxt = async () => parseRobotsTxt("User-agent: *\nDisallow: /");

		const outcome = await runPage(state.deps, { ...params, request: { ...params.request, respectRobotsTxt: true } });

		expect(outcome).toMatchObject({ ok: false, credits: 0, links: [] });
		expect(state.fetch).not.toHaveBeenCalled();
		expect(state.counts).toMatchObject({ succeeded: 0, failed: 1, credits: 0 });
		expect(state.usage.size).toBe(0);
		expect(JSON.parse(state.kv.get(pageResultKey("job_1", 0)) ?? "null")).toMatchObject({
			status: "error",
			error: { code: "robots_disallowed" },
		});
	});

	it("leaves other 5xx failures to the step's retries", async () => {
		const state = harness();
		state.fetch.mockRejectedValueOnce(new PlatformError("engine_failed", "render crashed", 502));

		await expect(runPage(state.deps, params)).rejects.toThrow("render crashed");
		expect(state.counts.failed).toBe(0);
	});

	it("counts a failed page once, never bills it, and preserves batch total", async () => {
		const state = harness();
		const batch = { ...params, countsTowardsTotal: false };
		const failure = new Error("database credentials in backend exception");
		await recordPageFailure(state.deps, batch, failure);
		await recordPageFailure(state.deps, batch, failure);
		expect(state.counts).toEqual({ succeeded: 0, failed: 1, total: 0, credits: 0 });
		expect(state.usage.size).toBe(0);
		expect(state.kv.get(pageResultKey("job_1", 0))).not.toContain(failure.message);
		expect(state.deps.reportUsage).not.toHaveBeenCalled();
	});

	it("keeps a successfully committed page usable during a Stripe outage", async () => {
		const state = harness();
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		state.deps.reportUsage = async () => {
			throw new Error("Stripe unavailable");
		};
		try {
			expect(await runPage(state.deps, params)).toMatchObject({ ok: true });
			expect(state.usage.size).toBe(1);
			expect(log).toHaveBeenCalled();
		} finally {
			log.mockRestore();
		}
	});
});
