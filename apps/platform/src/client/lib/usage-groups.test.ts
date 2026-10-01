import { describe, expect, it } from "vitest";
import type { UsageEvent } from "./api";
import { groupUsage } from "./usage-groups";

const event = (id: string, operation: string, credits: number, jobId: string | null = null): UsageEvent => ({
	id,
	jobId,
	operation,
	credits,
	createdAt: `2026-09-24T12:00:${id.padStart(2, "0")}Z`,
});

describe("groupUsage", () => {
	it("collapses adjacent pages of one job into a single row and keeps requests apart", () => {
		const groups = groupUsage([
			event("9", "fetch", 1),
			event("8", "fetch", 1, "job_a"),
			event("7", "browser", 2, "job_a"),
			event("6", "fetch", 1, "job_a"),
			event("5", "browser", 2),
		]);

		expect(groups).toEqual([
			{ kind: "request", id: "9", engine: "fetch", credits: 1, createdAt: "2026-09-24T12:00:09Z" },
			{
				kind: "job",
				id: "8",
				jobId: "job_a",
				pages: 3,
				engines: ["fetch", "browser"],
				credits: 4,
				createdAt: "2026-09-24T12:00:08Z",
			},
			{ kind: "request", id: "5", engine: "browser", credits: 2, createdAt: "2026-09-24T12:00:05Z" },
		]);
	});

	it("starts a new row when a job's pages are interleaved with other usage", () => {
		const groups = groupUsage([
			event("3", "fetch", 1, "job_a"),
			event("2", "fetch", 1),
			event("1", "fetch", 1, "job_a"),
		]);
		expect(groups.map((group) => group.kind)).toEqual(["job", "request", "job"]);
	});
});
