import { useState } from "react";
import {
	ENGINE_CREDITS,
	FREE_MONTHLY_CREDITS,
	REHOST_IMAGES_PER_CREDIT,
	SCREENSHOT_CREDITS,
} from "../../../billing/credits";
import type { Engine } from "../../../core/types";
import { cn } from "../../lib/cn";
import { formatNumber } from "../../lib/format";
import { estimateMonth, formatUsd, paidTiers, usdPerThousandPages } from "../../lib/pricing";
import { Link } from "../../lib/router";
import { buttonClass } from "../../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import { TBody, TD, TH, THead, TR, Table } from "../../ui/table";

const ENGINE_ROWS: { engine: Engine; label: string }[] = [
	{ engine: "fetch", label: "Plain fetch" },
	{ engine: "browser", label: "Browser rendering" },
	{ engine: "proxy-fetch", label: "Fetch via rotating proxy" },
	{ engine: "proxy-browser", label: "Browser via rotating proxy" },
];

const tierLabel = (from: number, upTo: number | null): string =>
	upTo === null ? `above ${formatNumber(from - 1)}` : `${formatNumber(from)} – ${formatNumber(upTo)}`;

/** Per-engine dollars per 1,000 pages at the first paid tier and at the deepest volume tier. */
const EnginePrices = () => {
	const tiers = paidTiers();
	const first = tiers[0];
	const last = tiers.at(-1);
	if (first === undefined || last === undefined) {
		return null;
	}
	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>Per 1,000 pages</CardTitle>
				<CardDescription>What each engine costs once the free credits are used.</CardDescription>
			</CardHeader>
			<div className="pb-2">
				<Table>
					<THead>
						<TR>
							<TH>Engine</TH>
							<TH className="text-right">Credits</TH>
							<TH className="text-right">Per 1k pages</TH>
							<TH className="text-right">At volume</TH>
						</TR>
					</THead>
					<TBody>
						<TR>
							<TD>
								<span className="font-mono text-accent">auto</span>
								<span className="hidden text-muted-foreground text-xs sm:block">
									default — fetch, browser only when needed
								</span>
							</TD>
							<TD className="text-right font-mono tabular">
								{ENGINE_CREDITS.fetch}–{ENGINE_CREDITS.browser}
							</TD>
							<TD className="text-right font-mono tabular">
								{formatUsd(usdPerThousandPages("fetch", first))}–{formatUsd(usdPerThousandPages("browser", first))}
							</TD>
							<TD className="text-right font-mono text-muted-foreground tabular">
								{formatUsd(usdPerThousandPages("fetch", last))}–{formatUsd(usdPerThousandPages("browser", last))}
							</TD>
						</TR>
						{ENGINE_ROWS.map((row) => (
							<TR key={row.engine}>
								<TD>
									<span className="font-mono">{row.engine}</span>
									<span className="hidden text-muted-foreground text-xs sm:block">{row.label}</span>
								</TD>
								<TD className="text-right font-mono tabular">{ENGINE_CREDITS[row.engine]}</TD>
								<TD className="text-right font-mono tabular">{formatUsd(usdPerThousandPages(row.engine, first))}</TD>
								<TD className="text-right font-mono text-muted-foreground tabular">
									{formatUsd(usdPerThousandPages(row.engine, last))}
								</TD>
							</TR>
						))}
					</TBody>
				</Table>
			</div>
			<p className="px-5 pb-5 text-muted-foreground text-xs leading-relaxed">
				"At volume" is the rate above {formatNumber(tiers.at(-2)?.upTo ?? 0)} credits in a month. Screenshot +
				{SCREENSHOT_CREDITS} credit, image rehosting +1 per started {REHOST_IMAGES_PER_CREDIT} images. Failed operations
				are never billed.
			</p>
		</Card>
	);
};

/** The graduated tiers, free allowance first. */
const Tiers = () => {
	const tiers = paidTiers();
	let from = FREE_MONTHLY_CREDITS + 1;
	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>Credits per month</CardTitle>
				<CardDescription>
					Pay as you go, no plans. Each rate applies only to the credits inside its band.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-2">
				<div className="flex items-baseline justify-between rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
					<span className="text-sm">first {formatNumber(FREE_MONTHLY_CREDITS)}</span>
					<span className="font-medium font-mono text-accent">free</span>
				</div>
				{tiers.map((tier) => {
					const label = tierLabel(from, tier.upTo);
					from = (tier.upTo ?? 0) + 1;
					return (
						<div key={label} className="flex items-baseline justify-between rounded-lg border border-border px-4 py-3">
							<span className="font-mono text-muted-foreground text-sm tabular">{label}</span>
							<span className="font-mono tabular">
								{formatUsd(tier.microUsdPerCredit / 1_000_000)}
								<span className="text-muted-foreground text-xs"> / credit</span>
							</span>
						</div>
					);
				})}
				<p className="mt-2 text-muted-foreground text-xs leading-relaxed">
					Without a subscription the API stops at the free allowance with{" "}
					<code className="font-mono text-accent">402 payment_required</code> — no surprise bills. No card required to
					start. A subscription comes with a monthly spend cap — $50 by default, adjustable on the dashboard — and
					unlocks the proxy engines.
				</p>
			</CardContent>
		</Card>
	);
};

const PAGE_PRESETS = [10_000, 100_000, 1_000_000];

/** A month of `auto` traffic → credits and dollars, from the same tiers Stripe bills. */
const Estimator = () => {
	const [pages, setPages] = useState(50_000);
	const [renderedPercent, setRenderedPercent] = useState(20);
	const [region, setRegion] = useState(false);
	const estimate = estimateMonth({ pages, renderedShare: renderedPercent / 100, region });

	return (
		<Card className="min-w-0 lg:col-span-2">
			<CardHeader>
				<CardTitle>Estimate your month</CardTitle>
				<CardDescription>
					For the default <span className="font-mono">auto</span> engine: pages that need JavaScript are rendered in a
					browser and billed at the browser rate.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
				<div className="flex flex-col gap-5">
					<div className="flex flex-col gap-2">
						<label htmlFor="estimate-pages" className="font-medium text-sm">
							Pages per month
						</label>
						<input
							id="estimate-pages"
							type="number"
							min={0}
							step={1000}
							value={pages}
							onChange={(event) => setPages(Math.max(0, Number(event.target.value) || 0))}
							className="h-10 w-full rounded-md border border-border bg-input px-3 font-mono text-base tabular sm:text-sm"
						/>
						<div className="flex flex-wrap gap-1.5">
							{PAGE_PRESETS.map((preset) => (
								<button
									key={preset}
									type="button"
									aria-pressed={pages === preset}
									onClick={() => setPages(preset)}
									className={cn(
										"rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors",
										pages === preset
											? "border-accent text-accent"
											: "border-border text-muted-foreground hover:text-foreground",
									)}
								>
									{formatNumber(preset)}
								</button>
							))}
						</div>
					</div>
					<div className="flex flex-col gap-2">
						<label htmlFor="estimate-rendered" className="flex justify-between font-medium text-sm">
							<span>Pages that need a browser</span>
							<span className="font-mono text-muted-foreground tabular">{renderedPercent}%</span>
						</label>
						<input
							id="estimate-rendered"
							type="range"
							min={0}
							max={100}
							step={5}
							value={renderedPercent}
							onChange={(event) => setRenderedPercent(Number(event.target.value))}
							className="w-full accent-accent"
						/>
					</div>
					<label className="flex items-center gap-2 text-sm">
						<input type="checkbox" checked={region} onChange={(event) => setRegion(event.target.checked)} />
						Send from Japanese IPs (proxy engines, paid plans)
					</label>
				</div>
				<div className="flex flex-col justify-center rounded-xl bg-muted/60 p-5">
					<p className="text-muted-foreground text-sm">Estimated monthly bill</p>
					<p className="mt-1 font-mono text-4xl tabular tracking-tight">{formatUsd(estimate.monthlyUsd)}</p>
					<p className="mt-2 font-mono text-muted-foreground text-xs tabular">
						{formatNumber(estimate.credits)} credits · {formatUsd(estimate.usdPerThousand)} per 1k pages
					</p>
					{estimate.monthlyUsd === 0 ? <p className="mt-3 text-accent text-sm">Fits in the free allowance.</p> : null}
				</div>
			</CardContent>
		</Card>
	);
};

export const PricingSection = () => (
	<section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-16">
		<div className="flex flex-wrap items-end justify-between gap-4">
			<div>
				<h2 className="font-semibold text-2xl tracking-tight">Pricing</h2>
				<p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
					One counter — credits — metered per successful page. From $1 per 1,000 pages, with{" "}
					{formatNumber(FREE_MONTHLY_CREDITS)} credits free every month and lower rates as volume grows.
				</p>
			</div>
			<Link href="/signup" className={buttonClass("primary", "md")}>
				Start free
			</Link>
		</div>
		<div className="mt-8 grid gap-4 lg:grid-cols-2 lg:items-start">
			<EnginePrices />
			<Tiers />
			<Estimator />
		</div>
	</section>
);
