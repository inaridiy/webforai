import type { UsageEvent } from "./api";

/**
 * A row of the dashboard's usage list: a single request, or every page of one batch/crawl job
 * that sits together in the (newest-first) ledger. Jobs write one ledger row per page, so
 * without grouping a single crawl would fill the whole list.
 */
export type UsageGroup =
	| { kind: "request"; id: string; engine: string; credits: number; createdAt: string }
	| { kind: "job"; id: string; jobId: string; pages: number; engines: string[]; credits: number; createdAt: string };

export const groupUsage = (events: readonly UsageEvent[]): UsageGroup[] => {
	const groups: UsageGroup[] = [];
	for (const event of events) {
		const last = groups.at(-1);
		if (event.jobId && last?.kind === "job" && last.jobId === event.jobId) {
			last.pages += 1;
			last.credits += event.credits;
			if (!last.engines.includes(event.operation)) {
				last.engines.push(event.operation);
			}
			continue;
		}
		groups.push(
			event.jobId
				? {
						kind: "job",
						id: event.id,
						jobId: event.jobId,
						pages: 1,
						engines: [event.operation],
						credits: event.credits,
						createdAt: event.createdAt,
					}
				: {
						kind: "request",
						id: event.id,
						engine: event.operation,
						credits: event.credits,
						createdAt: event.createdAt,
					},
		);
	}
	return groups;
};
