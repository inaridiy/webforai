import { useState } from "react";
import type { UsageEvent } from "../../lib/api";
import { formatDateTime, formatNumber } from "../../lib/format";
import { Link } from "../../lib/router";
import { type UsageGroup, groupUsage } from "../../lib/usage-groups";
import { Button } from "../../ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import { TBody, TD, TH, THead, TR, Table, TableEmpty } from "../../ui/table";

/** Rows shown before "Show more"; the API returns the latest 50 ledger entries. */
const COLLAPSED_ROWS = 8;

const What = ({ group }: { group: UsageGroup }) =>
	group.kind === "request" ? (
		<>
			<span className="text-foreground">Scrape</span>
			<span className="ml-2 font-mono text-muted-foreground text-xs">{group.engine}</span>
		</>
	) : (
		<>
			<span className="text-foreground">
				Job, {formatNumber(group.pages)} page{group.pages === 1 ? "" : "s"}
			</span>
			<span className="ml-2 font-mono text-muted-foreground text-xs" title={group.jobId}>
				{group.engines.join(", ")}
			</span>
		</>
	);

export const UsageTable = ({ events, className }: { events: UsageEvent[]; className?: string }) => {
	const [expanded, setExpanded] = useState(false);
	const groups = groupUsage(events);
	const visible = expanded ? groups : groups.slice(0, COLLAPSED_ROWS);
	const hidden = groups.length - visible.length;

	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>Recent usage</CardTitle>
				<CardDescription>Successful requests, newest first. Failed ones are never billed.</CardDescription>
			</CardHeader>
			<div className="pb-2">
				<Table>
					<THead>
						<TR>
							<TH>What</TH>
							<TH>When</TH>
							<TH className="text-right">Credits</TH>
						</TR>
					</THead>
					<TBody>
						{groups.length === 0 ? (
							<TableEmpty colSpan={3}>
								<p className="font-medium text-foreground">No usage yet.</p>
								<p className="mx-auto mt-1.5 max-w-sm text-balance text-xs leading-relaxed">
									Convert a page in the{" "}
									<Link href="/playground" className="text-accent hover:underline">
										Playground
									</Link>
									, or send a request with your API key (see "Use your key" above). Each successful one appears here.
								</p>
							</TableEmpty>
						) : (
							visible.map((group) => (
								<TR key={group.id}>
									<TD className="text-sm">
										<What group={group} />
									</TD>
									<TD className="whitespace-nowrap text-muted-foreground text-xs">{formatDateTime(group.createdAt)}</TD>
									<TD className="text-right font-mono tabular">{formatNumber(group.credits)}</TD>
								</TR>
							))
						)}
					</TBody>
				</Table>
				{hidden > 0 || expanded ? (
					<div className="flex items-center justify-between gap-3 px-5 pt-3 pb-2 text-muted-foreground text-xs">
						<span>{expanded ? "Showing the latest 50 entries." : `${formatNumber(hidden)} more`}</span>
						<Button size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>
							{expanded ? "Show less" : "Show more"}
						</Button>
					</div>
				) : null}
			</div>
		</Card>
	);
};
