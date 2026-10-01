import { describe, expect, it, vi } from "vitest";
import type { ArtifactStore } from "../artifacts/store";
import { listCanonicalPageResults } from "./canonical-results";
import { type PageCommit, pageCommitId } from "./page-accounting";
import type { PageArchive } from "./page-archive";
import { JOB_RESULT_TTL_SECONDS, MAX_INLINE_RESULT_BYTES } from "./results";

const NOW = new Date("2026-09-06T00:00:00Z");

const harness = () => {
	const rows: PageCommit[] = [];
	const archives = new Map<string, PageArchive>();
	const putResult = vi.fn(async () => "https://example.com/result?token=signed");
	const artifacts: ArtifactStore = {
		putResult,
		putImage: async () => "https://example.com/image",
		putScreenshot: async () => "https://example.com/screenshot",
	};
	const add = (
		index: number,
		options: { failed?: boolean; markdown?: string; createdAt?: Date; jobId?: string } = {},
	) => {
		const jobId = options.jobId ?? "job_1";
		const resultKey = `${jobId}/${index}`;
		const status = options.failed ? "error" : "ok";
		const credits = options.failed ? 0 : 1;
		rows.push({
			id: pageCommitId(jobId, index),
			jobId,
			pageIndex: index,
			resultKey,
			status,
			credits,
			engine: "fetch",
			createdAt: options.createdAt ?? NOW,
		});
		const url = `https://example.com/${index}`;
		archives.set(resultKey, {
			result: options.failed
				? { status: "error", url, engine: "fetch", error: { code: "fetch_failed", message: "Unavailable" } }
				: {
						status: "ok",
						url,
						engine: "fetch",
						credits,
						metadata: {},
						markdown: options.markdown ?? `# Page ${index}`,
					},
			outcome: { url, ok: !options.failed, credits, links: [] },
		});
	};
	const deps = {
		artifacts,
		accounting: {
			hasPages: async (jobId: string) => rows.some((row) => row.jobId === jobId),
			list: async (jobId: string, afterIndex: number, limit: number, createdAfter: Date) =>
				rows
					.filter((row) => row.jobId === jobId && row.pageIndex > afterIndex && row.createdAt > createdAfter)
					.sort((a, b) => a.pageIndex - b.pageIndex)
					.slice(0, limit),
		},
		archives: {
			get: async (key: string) => {
				const value = archives.get(key);
				if (!value) throw new Error("R2 unavailable");
				return value;
			},
		},
	};
	return { deps, add, archives, putResult };
};

describe("canonical job results", () => {
	it("materializes only one oversized archive at a time", async () => {
		const state = harness();
		for (let index = 0; index < 20; index++) state.add(index, { markdown: "x".repeat(MAX_INLINE_RESULT_BYTES + 1) });
		const originalGet = state.deps.archives.get;
		let active = 0;
		let peak = 0;
		state.deps.archives.get = async (key) => {
			active++;
			peak = Math.max(peak, active);
			return originalGet(key);
		};
		state.putResult.mockImplementation(async () => {
			await Promise.resolve();
			active--;
			return "https://example.com/result?token=signed";
		});
		const page = await listCanonicalPageResults(state.deps, "job_1", undefined, NOW);
		expect(page?.results).toHaveLength(20);
		expect(peak).toBe(1);
		expect(active).toBe(0);
	});
	it("serves paid results without KV and paginates in numeric index order", async () => {
		const state = harness();
		for (let index = 24; index >= 0; index -= 1) state.add(index);
		state.add(26, { jobId: "another_job" });
		const first = await listCanonicalPageResults(state.deps, "job_1", undefined, NOW);
		expect(first?.results.map((result) => result.url)).toEqual(
			Array.from({ length: 20 }, (_, index) => `https://example.com/${index}`),
		);
		expect(first?.cursor).toBeDefined();
		const second = await listCanonicalPageResults(state.deps, "job_1", first?.cursor, NOW);
		expect(second?.results.map((result) => result.url)).toEqual(
			Array.from({ length: 5 }, (_, index) => `https://example.com/${index + 20}`),
		);
		expect(second?.cursor).toBeUndefined();
	});

	it("retains errors and spills oversized successes with the existing result envelope", async () => {
		const state = harness();
		state.add(0, { failed: true });
		state.add(1, { markdown: "x".repeat(MAX_INLINE_RESULT_BYTES + 1) });
		const page = await listCanonicalPageResults(state.deps, "job_1", undefined, NOW);
		expect(page?.results).toMatchObject([
			{ status: "error", error: { code: "fetch_failed" } },
			{ status: "ok", credits: 1, resultUrl: "https://example.com/result?token=signed" },
		]);
		expect(page?.results[1]).not.toHaveProperty("markdown");
	});

	it("never revives expired marked pages via legacy KV fallback", async () => {
		const state = harness();
		state.add(0, { createdAt: new Date(NOW.getTime() - JOB_RESULT_TTL_SECONDS * 1000) });
		expect(await listCanonicalPageResults(state.deps, "job_1", undefined, NOW)).toEqual({ results: [] });
		expect(await listCanonicalPageResults(state.deps, "legacy_job", undefined, NOW)).toBeUndefined();
	});

	it("limits a regenerated oversized-result link to the original retention window", async () => {
		const state = harness();
		state.add(0, {
			markdown: "x".repeat(MAX_INLINE_RESULT_BYTES + 1),
			createdAt: new Date(NOW.getTime() - (JOB_RESULT_TTL_SECONDS - 30) * 1000),
		});
		await listCanonicalPageResults(state.deps, "job_1", undefined, NOW);
		expect(state.putResult).toHaveBeenCalledWith(expect.any(String), "job_1/00000", 30);
	});

	it("reports a missing paid archive as retryable instead of silently omitting the page", async () => {
		const state = harness();
		state.add(0);
		state.archives.clear();
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			await expect(listCanonicalPageResults(state.deps, "job_1", undefined, NOW)).rejects.toMatchObject({
				code: "result_unavailable",
				status: 503,
			});
		} finally {
			log.mockRestore();
		}
	});

	it.each(["bad", "p1:-1", "p1:1.5", "p1:01", "p1:9007199254740992"])("rejects malformed cursor %s", async (cursor) => {
		const state = harness();
		state.add(0);
		await expect(listCanonicalPageResults(state.deps, "job_1", cursor, NOW)).rejects.toMatchObject({
			code: "invalid_cursor",
			status: 400,
		});
	});
});
