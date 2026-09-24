import { type CrawlScope, discoverLinks } from "../core/links";
import { type ScrapeDeps, convertFetchedPage, fetchForScrape } from "../core/scrape-core";
import { EscalationExhaustedError, PlatformError, type ScrapeRequest } from "../core/types";
import { type PageAccountingRepo, type PageCommit, pageCommitId } from "./page-accounting";
import type { PageArchive, PageArchiveStore } from "./page-archive";
import { type JobResultsDeps, putPageResult } from "./results";

export interface PageOutcome {
	url: string;
	ok: boolean;
	credits: number;
	links: string[];
}

export interface PageDeps {
	scrape: ScrapeDeps;
	results: JobResultsDeps;
	accounting: PageAccountingRepo;
	archives: PageArchiveStore;
	guard: (userId: string) => Promise<void>;
	/** Reports the existing deterministic ledger event; never creates another usage row. */
	reportUsage: (page: PageCommit) => Promise<void>;
	now: () => Date;
}

export interface RunPageParams {
	jobId: string;
	userId: string;
	index: number;
	request: ScrapeRequest;
	scope?: CrawlScope;
	countsTowardsTotal: boolean;
}

export const MAX_LINKS_PER_PAGE = 200;
const MAX_STEP_LINK_BYTES = 64 * 1024;

const boundedLinks = (links: string[]): string[] => {
	let bytes = 0;
	const encoder = new TextEncoder();
	return links.slice(0, MAX_LINKS_PER_PAGE).filter((link) => {
		bytes += encoder.encode(JSON.stringify(link)).byteLength;
		return bytes <= MAX_STEP_LINK_BYTES;
	});
};

/** Forward recovery: a committed page is authoritative even if KV publication previously failed. */
const publish = async (deps: PageDeps, page: PageCommit): Promise<PageOutcome> => {
	const archive = await deps.archives.get(page.resultKey);
	await putPageResult(deps.results, page.jobId, page.pageIndex, archive.result);
	if (page.status === "ok") {
		try {
			await deps.reportUsage(page);
		} catch (error) {
			console.error("page_usage_reporting_failed", { jobId: page.jobId, pageIndex: page.pageIndex, error });
		}
	}
	return archive.outcome;
};

const commit = async (deps: PageDeps, params: RunPageParams, archive: PageArchive): Promise<PageOutcome> => {
	// R2 is written first; a lost response can leave an unreferenced attempt object, but
	// committed D1 rows always reference an object that was successfully written.
	const resultKey = await deps.archives.put(params.jobId, params.index, archive);
	const page = await deps.accounting.commit({
		page: {
			id: pageCommitId(params.jobId, params.index),
			jobId: params.jobId,
			pageIndex: params.index,
			resultKey,
			status: archive.result.status,
			engine: archive.result.engine,
			credits: archive.outcome.credits,
			createdAt: deps.now(),
		},
		userId: params.userId,
		countsTowardsTotal: params.countsTowardsTotal,
	});
	return publish(deps, page);
};

export const runPage = async (deps: PageDeps, params: RunPageParams): Promise<PageOutcome> => {
	const cached = await deps.accounting.get(pageCommitId(params.jobId, params.index));
	if (cached) return publish(deps, cached);
	await deps.guard(params.userId);

	let archive: PageArchive;
	try {
		const page = await fetchForScrape(deps.scrape, params.request);
		const links = params.scope ? boundedLinks(discoverLinks(page.html, page.url, params.scope)) : [];
		const result = await convertFetchedPage(deps.scrape, params.request, page);
		archive = {
			result: { status: "ok", ...result },
			outcome: { url: result.url, ok: true, credits: result.credits, links },
		};
	} catch (error) {
		// Final failures are recorded now; only transient ones go back to the step's retries.
		const final =
			error instanceof EscalationExhaustedError ||
			(error instanceof PlatformError && error.status >= 400 && error.status < 500);
		if (!final) throw error;
		return recordPageFailure(deps, params, error);
	}
	return commit(deps, params, archive);
};

/** Failure publication also recovers a success whose accounting response was lost. */
export const recordPageFailure = async (
	deps: PageDeps,
	params: RunPageParams,
	error: unknown,
): Promise<PageOutcome> => {
	const cached = await deps.accounting.get(pageCommitId(params.jobId, params.index));
	if (cached) return publish(deps, cached);
	const failure =
		error instanceof PlatformError
			? { code: error.code, message: error.message }
			: { code: "page_failed", message: "The page could not be processed. Please retry later." };
	return commit(deps, params, {
		result: { status: "error", url: params.request.url, engine: params.request.engine, error: failure },
		outcome: { url: params.request.url, ok: false, credits: 0, links: [] },
	});
};
