import { ARTIFACT_URL_TTL_SECONDS, type ArtifactStore } from "../artifacts/store";
import { PlatformError } from "../core/types";
import type { PageAccountingRepo } from "./page-accounting";
import type { PageArchive, PageArchiveStore } from "./page-archive";
import { DEFAULT_RESULTS_PAGE_SIZE, JOB_RESULT_TTL_SECONDS, type PageResultsPage, preparePageResult } from "./results";

interface CanonicalResultsDeps {
	accounting: Pick<PageAccountingRepo, "hasPages" | "list">;
	archives: Pick<PageArchiveStore, "get">;
	artifacts: ArtifactStore;
}

const cursorFor = (index: number): string => `p1:${index}`;
const readCursor = (cursor: string | undefined): number => {
	if (cursor === undefined) return -1;
	const match = /^p1:(0|[1-9]\d*)$/.exec(cursor);
	const index = Number(match?.[1]);
	if (!match || !Number.isSafeInteger(index)) throw new PlatformError("invalid_cursor", "Invalid results cursor.", 400);
	return index;
};

/** Returns undefined only for legacy jobs, whose results still live exclusively in KV. */
export const listCanonicalPageResults = async (
	deps: CanonicalResultsDeps,
	jobId: string,
	cursor: string | undefined,
	now: Date,
): Promise<PageResultsPage | undefined> => {
	if (!(await deps.accounting.hasPages(jobId))) return undefined;
	const rows = await deps.accounting.list(
		jobId,
		readCursor(cursor),
		DEFAULT_RESULTS_PAGE_SIZE + 1,
		new Date(now.getTime() - JOB_RESULT_TTL_SECONDS * 1000),
	);
	const page = rows.slice(0, DEFAULT_RESULTS_PAGE_SIZE);
	// Archives may each approach the input limit. Materialize one at a time so a
	// 20-result response cannot hold twenty full documents plus serialization copies.
	const results: PageResultsPage["results"] = [];
	for (const row of page) {
		let archive: PageArchive;
		try {
			archive = await deps.archives.get(row.resultKey);
		} catch (error) {
			console.error("job_result_unavailable", { jobId, pageIndex: row.pageIndex, error });
			throw new PlatformError(
				"result_unavailable",
				"A committed result is temporarily unavailable. Retry this results request.",
				503,
			);
		}
		const remaining = Math.max(
			1,
			Math.floor((row.createdAt.getTime() + JOB_RESULT_TTL_SECONDS * 1000 - now.getTime()) / 1000),
		);
		results.push(
			await preparePageResult(
				deps.artifacts,
				jobId,
				row.pageIndex,
				archive.result,
				Math.min(ARTIFACT_URL_TTL_SECONDS, remaining),
			),
		);
	}
	const last = page.at(-1);
	return rows.length > DEFAULT_RESULTS_PAGE_SIZE && last ? { results, cursor: cursorFor(last.pageIndex) } : { results };
};
