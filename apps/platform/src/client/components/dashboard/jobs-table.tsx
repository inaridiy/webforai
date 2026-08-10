import { fetchJobs } from "../../lib/api";
import type { JobStatus } from "../../lib/api";
import { formatDateTime, formatNumber } from "../../lib/format";
import { useAsyncResult } from "../../lib/use-async";
import type { BadgeTone } from "../../ui/badge";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import { LoadingRow } from "../../ui/spinner";
import { TBody, TD, TH, THead, TR, Table, TableEmpty } from "../../ui/table";

const toneFor = (status: JobStatus): BadgeTone => {
	if (status === "completed") {
		return "success";
	}
	if (status === "failed") {
		return "destructive";
	}
	if (status === "running") {
		return "accent";
	}
	return "neutral";
};

export const JobsTable = () => {
	const { state, reload } = useAsyncResult(fetchJobs);
	// A non-200 here means the jobs endpoint is not served yet — show the empty state, not an error.
	const jobs = state.status === "ready" ? state.value : [];

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-2">
					<div className="flex flex-col gap-1">
						<CardTitle>Jobs</CardTitle>
						<CardDescription>Batch and crawl runs from the last 30 days.</CardDescription>
					</div>
					<Button size="sm" variant="ghost" onClick={reload}>
						Refresh
					</Button>
				</div>
			</CardHeader>
			<div className="px-5 pb-4">
				{state.status === "loading" ? (
					<LoadingRow label="Loading jobs" />
				) : (
					<Table>
						<THead>
							<TR>
								<TH>Job</TH>
								<TH>Type</TH>
								<TH>Status</TH>
								<TH className="text-right">Pages</TH>
								<TH className="text-right">Credits</TH>
								<TH>Started</TH>
							</TR>
						</THead>
						<TBody>
							{jobs.length === 0 ? (
								<TableEmpty colSpan={6}>No batch or crawl jobs yet.</TableEmpty>
							) : (
								jobs.map((job) => (
									<TR key={job.id}>
										<TD className="font-mono text-muted-foreground text-xs">{job.id}</TD>
										<TD className="text-xs uppercase tracking-wide">{job.type}</TD>
										<TD>
											<Badge tone={toneFor(job.status)}>{job.status}</Badge>
										</TD>
										<TD className="text-right font-mono text-xs tabular">
											{formatNumber(job.succeeded)}/{formatNumber(job.total)}
											{job.failed > 0 ? (
												<span className="text-destructive"> ({formatNumber(job.failed)} failed)</span>
											) : null}
										</TD>
										<TD className="text-right font-mono tabular">{formatNumber(job.creditsUsed)}</TD>
										<TD className="text-muted-foreground text-xs">{formatDateTime(job.createdAt)}</TD>
									</TR>
								))
							)}
						</TBody>
					</Table>
				)}
			</div>
		</Card>
	);
};
