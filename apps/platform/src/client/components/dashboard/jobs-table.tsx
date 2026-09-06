import { fetchJobs } from "../../lib/api";
import type { JobStatus } from "../../lib/api";
import { formatDateTime, formatNumber } from "../../lib/format";
import { useAsyncResult } from "../../lib/use-async";
import { Alert } from "../../ui/alert";
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

export const JobsTable = ({ className }: { className?: string }) => {
	const { state, reload } = useAsyncResult(fetchJobs);
	const jobs = state.status === "ready" ? state.value : [];

	return (
		<Card className={className}>
			<CardHeader>
				<div className="flex items-start justify-between gap-2">
					<div className="flex flex-col gap-1">
						<CardTitle>Jobs</CardTitle>
						<CardDescription>Your most recent batch and crawl runs.</CardDescription>
					</div>
					<Button size="sm" variant="ghost" onClick={reload} disabled={state.status === "loading"}>
						Refresh
					</Button>
				</div>
			</CardHeader>
			<div className="pb-2">
				{state.status === "loading" ? (
					<div className="px-5">
						<LoadingRow label="Loading jobs" />
					</div>
				) : state.status === "error" ? (
					<div className="px-5 pb-3">
						<Alert tone="error" title="Jobs could not be loaded">
							<p className="break-words">{state.error}</p>
							<Button className="mt-2" size="sm" variant="outline" onClick={reload}>
								Retry
							</Button>
						</Alert>
					</div>
				) : (
					<Table>
						<THead>
							<TR>
								<TH>Job</TH>
								<TH>Status</TH>
								<TH className="text-right">Pages</TH>
								<TH className="text-right">Credits</TH>
								<TH className="text-right">Started</TH>
							</TR>
						</THead>
						<TBody>
							{jobs.length === 0 ? (
								<TableEmpty colSpan={5}>No batch or crawl jobs yet.</TableEmpty>
							) : (
								jobs.map((job) => (
									<TR key={job.id}>
										<TD>
											<div className="flex flex-col gap-0.5">
												<span className="font-medium text-[0.8125rem] capitalize">{job.type}</span>
												<span className="font-mono text-[0.6875rem] text-muted-foreground">{job.id}</span>
											</div>
										</TD>
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
										<TD className="text-right text-muted-foreground text-xs">{formatDateTime(job.createdAt)}</TD>
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
