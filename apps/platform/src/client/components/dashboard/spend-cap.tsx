import { useState } from "react";
import type { Result } from "../../lib/api";
import { type SpendCap, spendCapSchema } from "../../lib/api-schemas";
import { cn } from "../../lib/cn";
import { requestJson } from "../../lib/json-request";
import { formatUsd } from "../../lib/pricing";
import { useAsyncResult } from "../../lib/use-async";
import { Alert } from "../../ui/alert";
import { Button } from "../../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import { Field, Input } from "../../ui/input";
import { Progress } from "../../ui/progress";
import { LoadingRow, Spinner } from "../../ui/spinner";

const SPEND_CAP_PATH = "/api/dashboard/billing/spend-cap";

export const fetchSpendCap = (): Promise<Result<SpendCap>> => requestJson(fetch, SPEND_CAP_PATH, spendCapSchema);

export const saveSpendCap = (spendCapUsd: number): Promise<Result<SpendCap>> =>
	requestJson(fetch, SPEND_CAP_PATH, spendCapSchema, { method: "PUT", body: JSON.stringify({ spendCapUsd }) });

const CapForm = ({ cap, onSaved }: { cap: SpendCap; onSaved: (value: SpendCap) => void }) => {
	const [draft, setDraft] = useState(String(cap.spendCapUsd));
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
	const value = Number(draft);
	const valid = Number.isInteger(value) && value >= cap.minUsd && value <= cap.maxUsd;

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				if (!valid || pending) {
					return;
				}
				setPending(true);
				setMessage(null);
				saveSpendCap(value).then((result) => {
					setPending(false);
					if (result.ok) {
						onSaved(result.value);
						setMessage({ tone: "success", text: `Cap set to ${formatUsd(result.value.spendCapUsd)}.` });
						return;
					}
					setMessage({ tone: "error", text: result.error });
				});
			}}
		>
			<Field
				label="Cap (USD per month)"
				htmlFor="spend-cap"
				hint={`Whole dollars, ${formatUsd(cap.minUsd)}–${formatUsd(cap.maxUsd).replace(".00", "")}.`}
			>
				<div className="flex flex-wrap gap-2">
					<Input
						id="spend-cap"
						type="number"
						inputMode="numeric"
						min={cap.minUsd}
						max={cap.maxUsd}
						step={1}
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						className="w-32"
					/>
					<Button type="submit" size="sm" className="h-10" disabled={!valid || pending}>
						{pending ? <Spinner /> : null}
						Save
					</Button>
				</div>
			</Field>
			{message === null ? null : (
				<p
					role={message.tone === "error" ? "alert" : "status"}
					className={cn("text-sm", message.tone === "error" ? "text-destructive" : "text-muted-foreground")}
				>
					{message.text}
				</p>
			)}
		</form>
	);
};

/**
 * The monthly spend cap: subscribers' requests are refused (`spend_cap_reached`) once this UTC
 * month's estimated bill reaches it. Shown only where billing is configured.
 */
export const SpendCapCard = ({ subscribed, className }: { subscribed: boolean; className?: string }) => {
	const cap = useAsyncResult(fetchSpendCap);

	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>Monthly spend cap</CardTitle>
				<CardDescription>
					Requests stop once this month's estimated bill reaches the cap. It resets on the 1st (UTC).
					{subscribed ? null : " Applies once billing is active."}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{cap.state.status === "loading" ? <LoadingRow label="Loading spend cap" /> : null}
				{cap.state.status === "error" ? (
					<Alert tone="error" title="Spend cap could not be loaded">
						<div className="flex flex-col gap-2">
							<p>{cap.state.error}</p>
							<div>
								<Button size="sm" variant="outline" onClick={cap.reload}>
									Retry
								</Button>
							</div>
						</div>
					</Alert>
				) : null}
				{cap.state.status === "ready" ? (
					<>
						{subscribed ? (
							<div className="flex flex-col gap-2">
								<p className="text-sm tabular">
									<span className="font-medium text-foreground">{formatUsd(cap.state.value.estimatedUsd)}</span>
									<span className="text-muted-foreground"> of {formatUsd(cap.state.value.spendCapUsd)} this month</span>
								</p>
								<Progress
									value={cap.state.value.estimatedUsd}
									max={cap.state.value.spendCapUsd}
									tone={cap.state.value.estimatedUsd / cap.state.value.spendCapUsd > 0.8 ? "warning" : "accent"}
								/>
							</div>
						) : null}
						<CapForm cap={cap.state.value} onSaved={cap.setValue} />
					</>
				) : null}
			</CardContent>
		</Card>
	);
};
