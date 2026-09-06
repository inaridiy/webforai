import { ulid } from "../core/ulid";
import type { PageOutcome } from "./page";
import type { PageResult } from "./results";

export interface PageArchive {
	result: PageResult;
	outcome: PageOutcome;
}

export interface PageArchiveStore {
	put(jobId: string, index: number, value: PageArchive): Promise<string>;
	get(key: string): Promise<PageArchive>;
}

/** Immutable attempt objects: concurrent attempts must never overwrite the winning page. */
export const createPageArchiveStore = (bucket: R2Bucket): PageArchiveStore => ({
	put: async (jobId, index, value) => {
		const key = `results/job-pages/${jobId}/${index}/${ulid()}.json`;
		await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json" } });
		return key;
	},
	get: async (key) => {
		const object = await bucket.get(key);
		if (!object) throw new Error("The committed page archive is unavailable.");
		return object.json<PageArchive>();
	},
});
