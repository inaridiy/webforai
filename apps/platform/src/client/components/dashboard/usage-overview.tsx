import { useState } from "react";
import type { SubscriptionStatus, UsageSummary } from "../../lib/api";
import { openBillingPortal, startCheckout } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatNumber, formatPeriodLabel } from "../../lib/format";
import { formatUsd, paidTiers } from "../../lib/pricing";
import { Link } from "../../lib/router";
import { Alert } from "../../ui/alert";
import type { BadgeTone } from "../../ui/badge";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../ui/card";
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

export const CreditsCard = ({ usage, className }: { usage: UsageSummary; className?: string }) => {
	const used = usage.monthCredits;
	const allowance = usage.freeAllowance;
	const remaining = Math.max(0, allowance - used);
	const overAllowance = used > allowance;
	const tone = overAllowance ? "destructive" : used / Math.max(1, allowance) > 0.8 ? "warning" : "accent";

	return (
		<Card className={cn("flex flex-col", className)}>
			<CardHeader>
				<div className="flex flex-wrap items-baseline justify-between gap-3">
					<CardTitle>Credits this month</CardTitle>
					<span className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider">
						{formatPeriodLabel()}
					</span>
				</div>
			</CardHeader>
			<CardContent className="flex flex-1 flex-col justify-end gap-4">
				<div className="flex flex-wrap items-baseline gap-2.5">
					<span className="font-mono text-5xl tracking-tight">{formatNumber(used)}</span>
					<span className="font-mono text-muted-foreground text-sm">/ {formatNumber(allowance)} free</span>
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

/** The first paid tier's per-credit price — what the next credit past the allowance costs. */
const firstPaidRate = (paidTiers()[0]?.microUsdPerCredit ?? 0) / 1_000_000;

export const BillingCard = ({ usage, className }: { usage: UsageSummary; className?: string }) => {
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
		<Card className={cn("flex flex-col", className)}>
			<CardHeader>
				<div className="flex items-center gap-2">
					<CardTitle>Subscription</CardTitle>
					<Badge tone={statusTone[usage.subscriptionStatus]}>{statusLabel[usage.subscriptionStatus]}</Badge>
				</div>
				<CardDescription>{statusCopy[usage.subscriptionStatus]}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-1 flex-col gap-3">
				{usage.billingEnabled ? null : (
					<Alert tone="info">Subscriptions are currently unavailable. You can use the free monthly allowance.</Alert>
				)}
				{error === null ? null : <Alert tone="error">{error}</Alert>}
				<div className="flex flex-wrap gap-2">
					{usage.subscriptionStatus === "active" || usage.subscriptionStatus === "past_due" ? (
						<Button
							size="sm"
							variant="outline"
							onClick={() => go("portal")}
							disabled={pending !== "none" || !usage.billingEnabled}
						>
							{pending === "portal" ? <Spinner /> : null}
							Manage billing
						</Button>
					) : (
						<Button size="sm" onClick={() => go("checkout")} disabled={pending !== "none" || !usage.billingEnabled}>
							{pending === "checkout" ? <Spinner /> : null}
							Subscribe
						</Button>
					)}
					{usage.subscriptionStatus === "none" || !usage.billingEnabled ? null : (
						<Button size="sm" variant="ghost" onClick={() => go("portal")} disabled={pending !== "none"}>
							Invoices
						</Button>
					)}
				</div>
			</CardContent>
			<CardFooter>
				<p className="text-muted-foreground text-xs">
					From <span className="font-mono tabular">{formatUsd(firstPaidRate)}</span> per credit past the first{" "}
					<span className="font-mono tabular">{formatNumber(usage.freeAllowance)}</span> each month, less at volume.{" "}
					<Link href="/#pricing" className="text-accent hover:underline">
						Pricing
					</Link>
				</p>
			</CardFooter>
		</Card>
	);
};
