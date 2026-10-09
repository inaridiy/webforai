import { ENGINE_CREDITS, FREE_MONTHLY_CREDITS } from "../../billing/credits";
import type { Engine } from "../../core/types";
import { ClientSnippets } from "../components/client-snippets";
import { DemoConsole } from "../components/landing/demo-console";
import { PricingSection } from "../components/landing/pricing-section";
import { formatNumber } from "../lib/format";
import { links, useDeploymentOrigin } from "../lib/links";
import { Link } from "../lib/router";
import { buttonClass } from "../ui/button";
import { TBody, TD, TH, THead, TR, Table } from "../ui/table";

const credits = (engine: Engine): string =>
	`${ENGINE_CREDITS[engine]} credit${ENGINE_CREDITS[engine] === 1 ? "" : "s"}`;

const Hero = () => (
	<section className="relative border-border border-b">
		<div className="dot-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
		<div className="relative mx-auto w-full max-w-6xl px-5 pt-16 pb-14 sm:pt-24 sm:pb-20">
			<h1 className="max-w-4xl text-balance font-semibold text-[2.5rem] leading-[1.04] tracking-[-0.035em] sm:text-6xl">
				Turn any web page into Markdown your model can read.
			</h1>
			<p className="mt-6 max-w-2xl text-lg text-muted-foreground leading-relaxed">
				Send a URL, get back the article as clean Markdown with its title, author and date. Navigation, ads and cookie
				banners are removed, and pages that only exist after JavaScript runs are rendered in a real browser first.
			</p>
			<DemoConsole className="mt-10" />
			<p className="mt-4 text-muted-foreground text-sm">
				The demo needs no account and allows 5 conversions every 10 minutes.{" "}
				<Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
					Create an account
				</Link>{" "}
				for an API key with {formatNumber(FREE_MONTHLY_CREDITS)} free credits a month. Japan egress (
				<code className="font-mono text-[0.8125rem]">region: "jp"</code>) is on paid plans.
			</p>
		</div>
	</section>
);

const STEPS: { title: string; body: string }[] = [
	{
		title: "Create an account",
		body: `${formatNumber(
			FREE_MONTHLY_CREDITS,
		)} credits every month are free, and no card is needed until you want more.`,
	},
	{
		title: "Create an API key",
		body: "On the dashboard. It is shown once; send it as a bearer token.",
	},
	{
		title: "Send your first request",
		body: "With curl, the TypeScript client from the webforai package, or the webforai CLI (npx @webforai/cli).",
	},
];

const GetStarted = () => {
	const origin = useDeploymentOrigin();
	return (
		<section className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
			<div>
				<h2 className="font-semibold text-3xl tracking-tight">Into your own code in three steps</h2>
				<ol className="mt-8 space-y-6">
					{STEPS.map((step, index) => (
						<li key={step.title} className="grid grid-cols-[2rem_1fr] gap-x-4">
							<span
								aria-hidden={true}
								className="flex size-8 items-center justify-center rounded-full border border-border bg-card font-medium text-sm tabular"
							>
								{index + 1}
							</span>
							<div>
								<h3 className="font-medium">{step.title}</h3>
								<p className="mt-1 text-muted-foreground text-sm leading-relaxed">{step.body}</p>
							</div>
						</li>
					))}
				</ol>
				<div className="mt-9 flex flex-wrap gap-3">
					<Link href="/signup" className={buttonClass("primary", "md")}>
						Create an account
					</Link>
					<a href={links.quickstart} className={buttonClass("ghost", "md")}>
						Read the quickstart
					</a>
				</div>
			</div>
			<ClientSnippets origin={origin} className="lg:pt-2" />
		</section>
	);
};

const OPERATIONS: { endpoint: string; title: string; body: string }[] = [
	{
		endpoint: "POST /v1/scrape",
		title: "One page, right away",
		body: "The Markdown and metadata come back in the same response.",
	},
	{
		endpoint: "POST /v1/batch",
		title: "Up to 100 URLs",
		body: "Runs in the background with retries; read the results page by page when the job is done.",
	},
	{
		endpoint: "POST /v1/crawl",
		title: "A whole site",
		body: "Follows links on the same site from a start URL, within the depth, page and path limits you set.",
	},
];

const Operations = () => (
	<section className="border-border border-y bg-card">
		<dl className="mx-auto grid w-full max-w-6xl gap-px bg-border md:grid-cols-3">
			{OPERATIONS.map((operation) => (
				<div key={operation.endpoint} className="bg-card px-5 py-10 md:px-8">
					<dt>
						<code className="font-mono text-accent text-sm">{operation.endpoint}</code>
						<span className="mt-3 block font-semibold text-lg">{operation.title}</span>
					</dt>
					<dd className="mt-2 text-muted-foreground text-sm leading-relaxed">{operation.body}</dd>
				</div>
			))}
		</dl>
	</section>
);

/** One step of the `auto` resolution, shown as the page's small flow diagram. */
const FlowStep = ({ engine, note }: { engine: Engine; note: string }) => (
	<div className="rounded-xl border border-border bg-card px-5 py-4">
		<div className="flex items-baseline justify-between gap-3">
			<code className="font-mono">{engine}</code>
			<span className="text-muted-foreground text-sm tabular">{credits(engine)}</span>
		</div>
		<p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{note}</p>
	</div>
);

const FlowArrow = ({ label }: { label: string }) => (
	<div className="flex items-center gap-3 py-1.5 pl-5 text-muted-foreground text-sm md:max-w-32 md:flex-col md:justify-center md:py-0 md:pl-0">
		<span aria-hidden={true} className="text-base md:hidden">
			↓
		</span>
		<span className="md:text-center">{label}</span>
		<span aria-hidden={true} className="hidden text-base md:block">
			→
		</span>
	</div>
);

const ENGINE_ROWS: { id: Engine; how: string; jp: boolean; screenshot: boolean }[] = [
	{ id: "fetch", how: "Plain HTTP request from Cloudflare's edge", jp: false, screenshot: false },
	{ id: "browser", how: "Headless Chromium; runs the page's JavaScript", jp: false, screenshot: true },
	{ id: "proxy-fetch", how: "HTTP request through a rotating proxy", jp: true, screenshot: false },
	{ id: "proxy-browser", how: "Headless Chromium behind the rotating proxy", jp: true, screenshot: true },
];

const Engines = () => (
	<section className="mx-auto w-full max-w-6xl px-5 py-20">
		<div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center">
			<div>
				<h2 className="font-semibold text-3xl tracking-tight">You only pay for a browser when the page needs one</h2>
				<p className="mt-4 text-muted-foreground leading-relaxed">
					Requests default to <code className="font-mono text-foreground text-sm">auto</code>. It fetches the page
					plainly, and only if the HTML turns out to be an empty JavaScript shell or the site refuses the request does
					it run the page again in a browser. The response says which engine produced it, and that is the one you are
					billed for.
				</p>
				<p className="mt-4 text-muted-foreground text-sm leading-relaxed">
					Set <code className="font-mono text-foreground">"region": "jp"</code> to leave from Japanese IP addresses
					through the proxy pair instead. The proxy engines need an active subscription; the free credits cover{" "}
					<code className="font-mono text-foreground">fetch</code>,{" "}
					<code className="font-mono text-foreground">browser</code> and{" "}
					<code className="font-mono text-foreground">auto</code>.
				</p>
			</div>
			<div className="grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-4">
				<FlowStep engine="fetch" note="Static pages: articles, docs, most blogs" />
				<FlowArrow label="needs JavaScript or blocked" />
				<FlowStep engine="browser" note="Single-page apps and bot-protected sites" />
			</div>
		</div>
		<div className="mt-12 overflow-hidden rounded-xl border border-border bg-card py-1">
			<Table>
				<THead>
					<TR>
						<TH>Pin an engine</TH>
						<TH>How it fetches</TH>
						<TH>Japanese IPs</TH>
						<TH>Screenshot</TH>
					</TR>
				</THead>
				<TBody>
					{ENGINE_ROWS.map((row) => (
						<TR key={row.id}>
							<TD className="font-mono">{row.id}</TD>
							<TD className="text-muted-foreground">{row.how}</TD>
							<TD className="text-muted-foreground">{row.jp ? "Yes" : "—"}</TD>
							<TD className="text-muted-foreground">{row.screenshot ? "Yes" : "—"}</TD>
						</TR>
					))}
				</TBody>
			</Table>
		</div>
	</section>
);

const Closing = () => (
	<section className="border-border border-t bg-card">
		<div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-5 py-16 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h2 className="font-semibold text-2xl tracking-tight">
					Start with {formatNumber(FREE_MONTHLY_CREDITS)} free credits
				</h2>
				<p className="mt-2 text-muted-foreground">
					That is {formatNumber(FREE_MONTHLY_CREDITS / ENGINE_CREDITS.fetch)} static pages or{" "}
					{formatNumber(FREE_MONTHLY_CREDITS / ENGINE_CREDITS.browser)} rendered ones, every month.
				</p>
			</div>
			<div className="flex gap-3">
				<Link href="/signup" className={buttonClass("primary", "lg")}>
					Create an account
				</Link>
				<Link href="/login" className={buttonClass("outline", "lg")}>
					Sign in
				</Link>
			</div>
		</div>
	</section>
);

export const LandingPage = () => (
	<>
		<Hero />
		<GetStarted />
		<Operations />
		<Engines />
		<PricingSection />
		<Closing />
	</>
);
