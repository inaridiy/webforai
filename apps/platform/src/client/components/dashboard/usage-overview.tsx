import { useState } from "react";
import { monthlyCostUsd } from "../../../billing/credits";
import type { SubscriptionStatus, UsageSummary } from "../../lib/api";
import { openBillingPortal, startCheckout } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatNumber } from "../../lib/format";
import { formatUsd, paidTiers } from "../../lib/pricing";
import { Link } from "../../lib/router";
import type { BadgeTone } from "../../ui/badge";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Progress } from "../../ui/progress";
import { Spinner } from "../../ui/spinner";

const statusTone: Record<SubscriptionStatus, BadgeTone> = {
	none: "neutral",
	active: "success",
	// biome-ignore lint/style/useNamingConvention: mirrors the subscriptionStatus value from the dashboard API
	past_due: "warning",
	canceled: "destructive",
};

const planName: Record<SubscriptionStatus, string> = {
	none: "Free",
	active: "Pay as you go",
	// biome-ignore lint/style/useNamingConvention: mirrors the subscriptionStatus value from the dashboard API
	past_due: "Pay as you go",
	canceled: "Free",
};

const statusLabel: Record<SubscriptionStatus, string> = {
	none: "free",
	active: "active",
	// biome-ignore lint/style/useNamingConvention: mirrors the subscriptionStatus value from the dashboard API
	past_due: "payment failed",
	canceled: "canceled",
};

const planCopy: Record<SubscriptionStatus, string> = {
	none: "Requests stop at the free allowance until you add billing.",
	active: "Credits past the free allowance are billed at the end of the month.",
	// biome-ignore lint/style/useNamingConvention: mirrors the subscriptionStatus value from the dashboard API
	past_due: "The last invoice failed. Update the payment method to keep requests running.",
	canceled: "Billing was canceled, so requests stop at the free allowance.",
};

/** The first paid tier's per-credit price — what the next credit past the allowance costs. */
const firstPaidRate = (paidTiers()[0]?.microUsdPerCredit ?? 0) / 1_000_000;

/** Usage resets with the calendar month, in UTC like the ledger. */
const resetLabel = (now: Date = new Date()): string =>
	new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
		new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
	);

const Stat = ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) => (
	<div className={cn("flex min-w-0 flex-col gap-3 px-5 py-5 sm:px-6", className)}>
		<h2 className="text-muted-foreground text-sm">{label}</h2>
		{children}
	</div>
);

const Credits = ({ usage }: { usage: UsageSummary }) => {
	const used = usage.monthCredits;
	const allowance = usage.freeAllowance;
	const over = used > allowance;
	const tone = over ? "destructive" : used / Math.max(1, allowance) > 0.8 ? "warning" : "accent";
	return (
		<Stat label="Credits used this month">
			<p className="flex flex-wrap items-baseline gap-x-2">
				<span className="font-semibold text-4xl tabular tracking-tight">{formatNumber(used)}</span>
				<span className="text-muted-foreground text-sm tabular">of {formatNumber(allowance)} free</span>
			</p>
			<Progress value={used} max={allowance} tone={tone} />
			<p className="text-muted-foreground text-sm">
				{over
					? `${formatNumber(used - allowance)} past the free allowance.`
					: `${formatNumber(allowance - used)} free credits left.`}{" "}
				Resets {resetLabel()}.
			</p>
		</Stat>
	);
};

const Bill = ({ usage }: { usage: UsageSummary }) => {
	const subscribed = usage.subscriptionStatus === "active" || usage.subscriptionStatus === "past_due";
	const bill = subscribed ? monthlyCostUsd(usage.monthCredits) : 0;
	return (
		<Stat label="Estimated bill this month">
			<p className="font-semibold text-4xl tabular tracking-tight">{formatUsd(bill)}</p>
			<p className="text-muted-foreground text-sm">
				{subscribed ? "From your usage so far. " : "Nothing is charged without billing. "}
				Past the free credits, from {formatUsd(firstPaidRate)} a credit, less at volume.{" "}
				<Link href="/#pricing" className="text-accent hover:underline">
					See pricing
				</Link>
			</p>
		</Stat>
	);
};

const Plan = ({ usage }: { usage: UsageSummary }) => {
	const [pending, setPending] = useState<"none" | "checkout" | "portal">("none");
	const [error, setError] = useState<string | null>(null);
	const subscribed = usage.subscriptionStatus === "active" || usage.subscriptionStatus === "past_due";

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
		<Stat label="Plan">
			<p className="flex flex-wrap items-center gap-2">
				<span className="font-semibold text-2xl tracking-tight">{planName[usage.subscriptionStatus]}</span>
				{usage.subscriptionStatus === "none" ? null : (
					<Badge tone={statusTone[usage.subscriptionStatus]}>{statusLabel[usage.subscriptionStatus]}</Badge>
				)}
			</p>
			<p className="text-muted-foreground text-sm">
				{usage.billingEnabled
					? planCopy[usage.subscriptionStatus]
					: "Billing is not available on this deployment; the free allowance still works."}
			</p>
			{error === null ? null : (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{usage.billingEnabled ? (
				<div className="mt-auto flex flex-wrap gap-2">
					{subscribed ? (
						<Button size="sm" variant="outline" onClick={() => go("portal")} disabled={pending !== "none"}>
							{pending === "portal" ? <Spinner /> : null}
							Manage billing
						</Button>
					) : (
						<Button size="sm" onClick={() => go("checkout")} disabled={pending !== "none"}>
							{pending === "checkout" ? <Spinner /> : null}
							Add billing
						</Button>
					)}
					{usage.subscriptionStatus === "none" ? null : (
						<Button size="sm" variant="ghost" onClick={() => go("portal")} disabled={pending !== "none"}>
							Invoices
						</Button>
					)}
				</div>
			) : null}
		</Stat>
	);
};

/** This month at a glance: what was used, what it will cost, and the plan behind it. */
export const UsagePanel = ({ usage, className }: { usage: UsageSummary; className?: string }) => (
	<Card
		className={cn(
			"grid grid-cols-1 divide-y divide-border md:grid-cols-[1.2fr_1fr_1fr] md:divide-x md:divide-y-0",
			className,
		)}
	>
		<Credits usage={usage} />
		<Bill usage={usage} />
		<Plan usage={usage} />
	</Card>
);
