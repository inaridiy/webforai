import { describe, expect, it } from "vitest";
import type { ArtifactStore } from "../artifacts/store";
import type { Engine } from "../core/types";
import {
	type JobKv,
	type JobResultsDeps,
	MAX_INLINE_RESULT_BYTES,
	type PageResult,
	getJobMeta,
	jobMetaKey,
	listPageResults,
	pageResultKey,
	putJobMeta,
	putPageResult,
} from "./results";

/**
 * Map-backed KV double. `list` sorts lexicographically and honours prefix/limit/cursor exactly
 * as Workers KV does, which is the whole point of the zero-padded keys under test.
 */
const fakeKv = () => {
	const store = new Map<string, { value: string; expirationTtl?: number }>();
	const kv: JobKv = {
		get: (key) => Promise.resolve(store.get(key)?.value ?? null),
		put: (key, value, options) => {
			store.set(key, { value, ...(options?.expirationTtl ? { expirationTtl: options.expirationTtl } : {}) });
			return Promise.resolve();
		},
		list: ({ prefix, limit = 1000, cursor }) => {
			const names = [...store.keys()].filter((name) => name.startsWith(prefix)).sort();
			const start = cursor ? Number(cursor) : 0;
			const slice = names.slice(start, start + limit);
			const next = start + slice.length;
			const complete = next >= names.length;
			return Promise.resolve({
				keys: slice.map((name) => ({ name })),
				list_complete: complete,
				...(complete ? {} : { cursor: String(next) }),
			});
		},
	};
	return { kv, store };
};

const artifactCalls: { key: string; bytes: number }[] = [];

const fakeArtifacts = (): ArtifactStore => ({
	putScreenshot: () => Promise.resolve("https://cdn.example.com/shot.png"),
	putImage: () => Promise.resolve("https://cdn.example.com/img.png"),
	putResult: (json, key) => {
		artifactCalls.push({ key, bytes: json.length });
		return Promise.resolve(`https://cdn.example.com/results/${key}.json?token=t`);
	},
});

const deps = (): JobResultsDeps & { store: Map<string, { value: string; expirationTtl?: number }> } => {
	artifactCalls.length = 0;
	const { kv, store } = fakeKv();
	return { kv, artifacts: fakeArtifacts(), store };
};

const okPage = (url: string, markdown = "# hi"): PageResult => ({
	status: "ok",
	url,
	engine: "fetch" as Engine,
	markdown,
	metadata: { title: "hi" },
	credits: 1,
});

describe("result keys", () => {
	it("zero-pads the page index so KV list order matches page order", () => {
		expect(pageResultKey("job_1", 0)).toBe("job:job_1:00000");
		expect(pageResultKey("job_1", 7)).toBe("job:job_1:00007");
		expect(pageResultKey("job_1", 123)).toBe("job:job_1:00123");
		// The bug the padding exists to prevent.
		expect([pageResultKey("job_1", 10), pageResultKey("job_1", 2)].sort()).toEqual([
			"job:job_1:00002",
			"job:job_1:00010",
		]);
	});
});

describe("listPageResults", () => {
	it("returns pages in index order and walks the cursor to the end", async () => {
		const store = deps();
		for (let index = 0; index < 25; index += 1) {
			await putPageResult(store, "job_1", index, okPage(`https://example.com/${index}`));
		}

		const first = await listPageResults(store, "job_1", undefined, 20);
		expect(first.results).toHaveLength(20);
		expect(first.results.map((result) => result.url)).toEqual(
			Array.from({ length: 20 }, (_, index) => `https://example.com/${index}`),
		);
		expect(first.cursor).toBeDefined();

		const second = await listPageResults(store, "job_1", first.cursor, 20);
		expect(second.results).toHaveLength(5);
		expect(second.results[0]?.url).toBe("https://example.com/20");
		expect(second.cursor).toBeUndefined();
	});

	it("never surfaces the job's own meta record as a page", async () => {
		const store = deps();
		await putPageResult(store, "job_1", 0, okPage("https://example.com/0"));
		await putJobMeta(store, {
			jobId: "job_1",
			type: "batch",
			status: "completed",
			total: 1,
			completed: 1,
			failed: 0,
			credits: 1,
			updatedAt: new Date(0).toISOString(),
		});

		const page = await listPageResults(store, "job_1", undefined, 20);
		expect(page.results).toHaveLength(1);
		expect(page.results[0]?.url).toBe("https://example.com/0");
	});

	it("does not leak another job's results", async () => {
		const store = deps();
		await putPageResult(store, "job_1", 0, okPage("https://example.com/mine"));
		await putPageResult(store, "job_2", 0, okPage("https://example.com/theirs"));

		const page = await listPageResults(store, "job_1", undefined, 20);
		expect(page.results.map((result) => result.url)).toEqual(["https://example.com/mine"]);
	});

	it("skips a value that expired between list and get instead of returning a hole", async () => {
		const store = deps();
		await putPageResult(store, "job_1", 0, okPage("https://example.com/0"));
		await putPageResult(store, "job_1", 1, okPage("https://example.com/1"));
		store.store.delete(pageResultKey("job_1", 1));

		const page = await listPageResults(store, "job_1", undefined, 20);
		expect(page.results.map((result) => result.url)).toEqual(["https://example.com/0"]);
	});
});

describe("oversized results", () => {
	it("keeps the KV value small by spilling the page to R2", async () => {
		const store = deps();
		const huge = "x".repeat(MAX_INLINE_RESULT_BYTES + 1);
		await putPageResult(store, "job_1", 3, okPage("https://example.com/big", huge));

		expect(artifactCalls).toEqual([{ key: "job_1/00003", bytes: expect.any(Number) }]);
		const stored = JSON.parse(store.store.get(pageResultKey("job_1", 3))?.value ?? "null");
		expect(stored.markdown).toBeUndefined();
		expect(stored.resultUrl).toContain("job_1/00003");
		expect(stored).toMatchObject({ status: "ok", url: "https://example.com/big", credits: 1 });
	});

	it("stores a result just under the cap inline", async () => {
		const store = deps();
		await putPageResult(store, "job_1", 0, okPage("https://example.com/small", "x".repeat(1000)));
		expect(artifactCalls).toEqual([]);
		expect(store.store.get(pageResultKey("job_1", 0))?.value).toContain("markdown");
	});
});

describe("job meta", () => {
	it("round-trips the snapshot and applies the results TTL", async () => {
		const store = deps();
		await putJobMeta(store, {
			jobId: "job_9",
			type: "crawl",
			status: "running",
			total: 3,
			completed: 2,
			failed: 1,
			credits: 4,
			updatedAt: new Date(0).toISOString(),
		});

		expect(await getJobMeta(store, "job_9")).toMatchObject({ jobId: "job_9", status: "running", completed: 2 });
		expect(store.store.get(jobMetaKey("job_9"))?.expirationTtl).toBe(7 * 24 * 60 * 60);
	});

	it("returns undefined for a job with no snapshot", async () => {
		expect(await getJobMeta(deps(), "missing")).toBeUndefined();
	});

	it("drops a corrupt value rather than throwing", async () => {
		const store = deps();
		await store.kv.put(jobMetaKey("job_x"), "{not json");
		expect(await getJobMeta(store, "job_x")).toBeUndefined();
	});
});

describe("page failures", () => {
	it("records the error shape the API documents", async () => {
		const store = deps();
		await putPageResult(store, "job_1", 0, {
			status: "error",
			url: "https://example.com/gone",
			engine: "fetch",
			error: { code: "fetch_failed", message: "upstream responded 503" },
		});

		const page = await listPageResults(store, "job_1", undefined, 20);
		expect(page.results[0]).toEqual({
			status: "error",
			url: "https://example.com/gone",
			engine: "fetch",
			error: { code: "fetch_failed", message: "upstream responded 503" },
		});
	});
});
