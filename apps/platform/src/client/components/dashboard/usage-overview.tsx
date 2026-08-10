import { useState } from "react";
import type { SubscriptionStatus, UsageSummary } from "../../lib/api";
import { openBillingPortal, startCheckout } from "../../lib/api";
import { formatNumber } from "../../lib/format";
import { Alert } from "../../ui/alert";
import type { BadgeTone } from "../../ui/badge";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import { Progress } from "../../ui/progress";
import { Spinner } from "../../ui/spinner";

const statusTone: Record<SubscriptionStatus, BadgeTone> = {
	none: "neutral",
	active: "success",
	// biome-ignore lint/style/useNamingConvention: mirrors the subscriptionStatus value from the dashboard API
	past_due: "warning",
	canceled: "destructive",
};

const statusLabel: Record<SubscriptionStatus, string> = {
	none: "free allowance",
	active: "active",
	// biome-ignore lint/style/useNamingConvention: mirrors the subscriptionStatus value from the dashboard API
	past_due: "past due",
	canceled: "canceled",
};

const statusCopy: Record<SubscriptionStatus, string> = {
	none: "You are on the free allowance. Subscribe to keep converting past the monthly credits.",
	active: "Metered subscription active. Credits beyond the free allowance are billed monthly.",
	// biome-ignore lint/style/useNamingConvention: mirrors the subscriptionStatus value from the dashboard API
	past_due: "The last invoice failed. Update the payment method to avoid interruption.",
	canceled: "The subscription was canceled. Only the free allowance is served.",
};

const CreditsCard = ({ usage }: { usage: UsageSummary }) => {
	const used = usage.monthCredits;
	const allowance = usage.freeAllowance;
	const remaining = Math.max(0, allowance - used);
	const overAllowance = used > allowance;
	const tone = overAllowance ? "destructive" : used / Math.max(1, allowance) > 0.8 ? "warning" : "accent";

	return (
		<Card>
			<CardHeader>
				<CardTitle>Credits this month</CardTitle>
				<CardDescription>Calendar month, counted from the local usage ledger.</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex items-baseline gap-2">
					<span className="font-mono text-4xl tabular tracking-tight">{formatNumber(used)}</span>
					<span className="font-mono text-muted-foreground text-sm tabular">/ {formatNumber(allowance)} free</span>
				</div>
				<Progress value={used} max={allowance} tone={tone} />
				<p className="text-muted-foreground text-sm">
					{overAllowance
						? `${formatNumber(used - allowance)} credits past the free allowance.`
						: `${formatNumber(remaining)} credits left in the free allowance.`}
				</p>
			</CardContent>
		</Card>
	);
};

const BillingCard = ({ usage }: { usage: UsageSummary }) => {
	const [pending, setPending] = useState<"none" | "checkout" | "portal">("none");
	const [error, setError] = useState<string | null>(null);

	const go = (kind: "checkout" | "portal"): void => {
		setError(null);
		setPending(kind);
		const request = kind === "checkout" ? startCheckout() : openBillingPortal();
		request.then((result) => {
			if (result.ok) {
				window.location.assign(result.value);
				return;
			}
			setError(result.error);
			setPending("none");
		});
	};

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<CardTitle>Subscription</CardTitle>
					<Badge tone={statusTone[usage.subscriptionStatus]}>{statusLabel[usage.subscriptionStatus]}</Badge>
				</div>
				<CardDescription>{statusCopy[usage.subscriptionStatus]}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{usage.billingEnabled ? null : (
					<Alert tone="info">
						Billing is not configured on this deployment. Only the free allowance is served — no Stripe keys are set.
					</Alert>
				)}
				{error === null ? null : <Alert tone="error">{error}</Alert>}
				<div className="flex flex-wrap gap-2">
					{usage.subscriptionStatus === "active" || usage.subscriptionStatus === "past_due" ? (
						<Button
							variant="outline"
							onClick={() => go("portal")}
							disabled={pending !== "none" || !usage.billingEnabled}
						>
							{pending === "portal" ? <Spinner /> : null}
							Manage billing
						</Button>
					) : (
						<Button onClick={() => go("checkout")} disabled={pending !== "none" || !usage.billingEnabled}>
							{pending === "checkout" ? <Spinner /> : null}
							Subscribe
						</Button>
					)}
					{usage.subscriptionStatus === "none" || !usage.billingEnabled ? null : (
						<Button variant="ghost" onClick={() => go("portal")} disabled={pending !== "none"}>
							Invoices
						</Button>
					)}
				</div>
				<p className="text-muted-foreground text-xs">
					<span className="font-mono tabular">$0.002</span> per credit past the first{" "}
					<span className="font-mono tabular">{formatNumber(usage.freeAllowance)}</span> each month.
				</p>
			</CardContent>
		</Card>
	);
};

export const UsageOverview = ({ usage }: { usage: UsageSummary }) => (
	<div className="grid gap-4 md:grid-cols-2">
		<CreditsCard usage={usage} />
		<BillingCard usage={usage} />
	</div>
);
