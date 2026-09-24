import { ENGINE_CREDITS, FREE_MONTHLY_CREDITS } from "../../billing/credits";
import { ClientSnippets } from "../components/client-snippets";
import { DemoSection } from "../components/landing/demo-section";
import { PricingSection } from "../components/landing/pricing-section";
import { formatNumber } from "../lib/format";
import { links, useDeploymentOrigin } from "../lib/links";
import { Link } from "../lib/router";
import { Badge } from "../ui/badge";
import { buttonClass } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { CodeBlock } from "../ui/code-block";
import { TBody, TD, TH, THead, TR, Table } from "../ui/table";

/** The curl sample advertises this very deployment, like the playground's equivalent-curl strip. */
const scrapeSnippet = (origin: string): string => {
	return `curl -X POST ${origin}/v1/scrape \\
  -H "Authorization: Bearer wfa_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com/article",
    "engine": "auto",
    "convert": { "extractor": "auto", "frontmatter": true }
  }'`;
};

const engines: { id: string; how: string; proxy: string; screenshot: string; credits: string }[] = [
	{
		id: "auto",
		how: "Cheapest engine first, escalates to browser rendering when the page needs JavaScript or blocks plain fetches",
		proxy: "with region",
		screenshot: "yes",
		credits: `${ENGINE_CREDITS.fetch}–${ENGINE_CREDITS.browser}`,
	},
	{
		id: "fetch",
		how: "Plain HTTP fetch from the edge",
		proxy: "no",
		screenshot: "no",
		credits: `${ENGINE_CREDITS.fetch}`,
	},
	{
		id: "browser",
		how: "Headless browser rendering",
		proxy: "no",
		screenshot: "yes",
		credits: `${ENGINE_CREDITS.browser}`,
	},
	{
		id: "proxy-fetch",
		how: "HTTP fetch through a rotating proxy",
		proxy: "yes",
		screenshot: "no",
		credits: `${ENGINE_CREDITS["proxy-fetch"]}`,
	},
	{
		id: "proxy-browser",
		how: "Headless browser behind the rotating proxy",
		proxy: "yes",
		screenshot: "yes",
		credits: `${ENGINE_CREDITS["proxy-browser"]}`,
	},
];

const capabilities: { title: string; body: string; tag: string }[] = [
	{
		tag: "POST /v1/scrape",
		title: "Scrape",
		body: "One URL in, Markdown plus metadata out. Runs synchronously on a plain Worker, so a single page returns in one request.",
	},
	{
		tag: "POST /v1/batch",
		title: "Batch",
		body: "Up to 100 URLs per job. Runs as a Cloudflare Workflow with retries; results are paged from the job results endpoint.",
	},
	{
		tag: "POST /v1/crawl",
		title: "Crawl",
		body: "Seed URL, same-origin BFS with depth and page limits plus include/exclude path patterns. Same conversion core as scrape.",
	},
];

const Hero = () => {
	const origin = useDeploymentOrigin();
	return (
		<section className="relative overflow-hidden border-border border-b">
			<div className="dot-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)]" />
			<div className="relative mx-auto grid w-full max-w-6xl gap-12 px-5 py-20 sm:py-24 lg:grid-cols-[minmax(0,1fr)_28.75rem] lg:items-center">
				<div>
					<Badge tone="accent">crawl to markdown api</Badge>
					<h1 className="mt-5 max-w-3xl text-balance font-semibold text-4xl leading-[1.08] tracking-tight sm:text-5xl">
						Any URL, converted to Markdown an LLM can actually read.
					</h1>
					<p className="mt-5 max-w-2xl text-lg text-muted-foreground leading-relaxed">
						webforai platform wraps the open-source{" "}
						<a href={links.libraryDocs} className="text-foreground underline-offset-4 hover:underline">
							webforai
						</a>{" "}
						extraction library in a metered HTTP API. Four acquisition engines — plain fetch, browser rendering, proxied
						fetch, proxied browser — behind one request body, and an <span className="font-mono">auto</span> default
						that renders client-side pages only when they need it.
					</p>
					<div className="mt-8 flex flex-wrap items-center gap-3">
						<Link href="/signup" className={buttonClass("primary", "lg")}>
							Get an API key
						</Link>
						<a href="#demo" className={buttonClass("outline", "lg")}>
							Try the live demo
						</a>
					</div>
					<p className="mt-4 text-[0.8125rem] text-muted-foreground">
						{formatNumber(FREE_MONTHLY_CREDITS)} free credits every month, then from $1 per 1,000 pages — no card
						required.
					</p>
				</div>
				<div className="min-w-0">
					<CodeBlock code={scrapeSnippet(origin)} label="curl" />
				</div>
			</div>
		</section>
	);
};

const Capabilities = () => (
	<section className="mx-auto w-full max-w-6xl px-5 py-16">
		<div className="grid gap-4 md:grid-cols-3">
			{capabilities.map((item) => (
				<Card key={item.tag}>
					<CardHeader>
						<span className="font-mono text-[0.6875rem] text-accent uppercase tracking-wider">{item.tag}</span>
						<CardTitle>{item.title}</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-muted-foreground text-sm leading-relaxed">{item.body}</p>
					</CardContent>
				</Card>
			))}
		</div>
	</section>
);

const Clients = () => {
	const origin = useDeploymentOrigin();
	return (
		<section className="mx-auto w-full max-w-6xl px-5 pb-16">
			<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start">
				<div>
					<h2 className="font-semibold text-2xl tracking-tight">Call it from anywhere</h2>
					<p className="mt-2 text-muted-foreground text-sm leading-relaxed">
						Plain HTTP with a bearer key, the typed <span className="font-mono">webforai/platform</span> client that
						ships in the <span className="font-mono">webforai</span> npm package, or the{" "}
						<span className="font-mono">npx webforai</span> CLI — pipes, scripts and AI agents included.
					</p>
					<div className="mt-5 flex flex-wrap gap-3">
						<a href={links.quickstart} className={buttonClass("outline", "sm")}>
							Quickstart
						</a>
						<a href={links.apiReference} className={buttonClass("ghost", "sm")}>
							API reference
						</a>
					</div>
				</div>
				<ClientSnippets origin={origin} />
			</div>
		</section>
	);
};

const Engines = () => (
	<section className="border-border border-y bg-muted/40">
		<div className="mx-auto w-full max-w-6xl px-5 py-16">
			<h2 className="font-semibold text-2xl tracking-tight">Four acquisition engines, one auto mode</h2>
			<p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
				The engine decides how the HTML is fetched; extraction and Markdown conversion are identical across all of them.
				The default <span className="font-mono">auto</span> starts cheap and escalates to browser rendering when a page
				turns out to be a client-side shell or refuses the plain fetch — you are billed for the engine that produced the
				result.
			</p>
			<div className="mt-8 rounded-xl border border-border bg-card py-2">
				<Table>
					<THead>
						<TR>
							<TH>Engine</TH>
							<TH>How it fetches</TH>
							<TH>Proxy</TH>
							<TH>Screenshot</TH>
							<TH className="text-right">Credits</TH>
						</TR>
					</THead>
					<TBody>
						{engines.map((engine) => (
							<TR key={engine.id}>
								<TD className="font-mono text-accent">{engine.id}</TD>
								<TD className="text-muted-foreground">{engine.how}</TD>
								<TD className="text-muted-foreground">{engine.proxy}</TD>
								<TD className="text-muted-foreground">{engine.screenshot}</TD>
								<TD className="text-right font-mono tabular">{engine.credits}</TD>
							</TR>
						))}
					</TBody>
				</Table>
			</div>
			<p className="mt-4 text-muted-foreground text-xs">
				Options add credits on top: screenshot +1, image rehosting +1 per started 5 images. Failed operations are never
				billed.
			</p>
		</div>
	</section>
);

const Closing = () => (
	<section className="border-border border-t">
		<div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-4 px-5 py-16 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h2 className="font-semibold text-xl tracking-tight">Start with the free allowance</h2>
				<p className="mt-1 text-muted-foreground text-sm">
					Create an account, mint a key, send the first request in a minute.
				</p>
			</div>
			<div className="flex gap-3">
				<Link href="/signup" className={buttonClass("primary", "md")}>
					Create account
				</Link>
				<Link href="/login" className={buttonClass("outline", "md")}>
					Sign in
				</Link>
			</div>
		</div>
	</section>
);

export const LandingPage = () => (
	<>
		<Hero />
		<DemoSection />
		<Capabilities />
		<Clients />
		<Engines />
		<PricingSection />
		<Closing />
	</>
);
