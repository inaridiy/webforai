import type { UsageEvent } from "../../lib/api";
import { formatDateTime, formatNumber } from "../../lib/format";
import { Card, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import { TBody, TD, TH, THead, TR, Table, TableEmpty } from "../../ui/table";

export const UsageTable = ({ events }: { events: UsageEvent[] }) => (
	<Card>
		<CardHeader>
			<CardTitle>Recent usage</CardTitle>
			<CardDescription>Ledger entries written after an operation succeeded. Failures are never billed.</CardDescription>
		</CardHeader>
		<div className="px-5 pb-4">
			<Table>
				<THead>
					<TR>
						<TH>Operation</TH>
						<TH>When</TH>
						<TH className="text-right">Credits</TH>
					</TR>
				</THead>
				<TBody>
					{events.length === 0 ? (
						<TableEmpty colSpan={3}>No usage recorded this month.</TableEmpty>
					) : (
						events.map((event) => (
							<TR key={event.id}>
								<TD className="font-mono text-accent text-xs">{event.operation}</TD>
								<TD className="text-muted-foreground text-xs">{formatDateTime(event.createdAt)}</TD>
								<TD className="text-right font-mono tabular">{formatNumber(event.credits)}</TD>
							</TR>
						))
					)}
				</TBody>
			</Table>
		</div>
	</Card>
);
