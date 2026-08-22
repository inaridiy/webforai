import { Link } from "../lib/router";
import { Badge } from "../ui/badge";
import { buttonClass } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { CodeBlock } from "../ui/code-block";
import { TBody, TD, TH, THead, TR, Table } from "../ui/table";

const scrapeSnippet = `curl -X POST https://<your-deployment>/v1/scrape \\
  -H "Authorization: Bearer wfa_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com/article",
    "engine": "fetch",
    "convert": { "extractor": "auto", "frontmatter": true }
  }'`;

const engines: { id: string; runtime: string; proxy: string; screenshot: string; credits: string }[] = [
	{ id: "fetch", runtime: "Workers fetch()", proxy: "no", screenshot: "no", credits: "1" },
	{ id: "proxy-fetch", runtime: "Node container, undici", proxy: "Webshare", screenshot: "no", credits: "2" },
	{ id: "proxy-browser", runtime: "Node container, Playwright", proxy: "Webshare", screenshot: "yes", credits: "5" },
	{ id: "cf-browser", runtime: "Cloudflare Browser Rendering", proxy: "no", screenshot: "yes", credits: "5" },
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

const Hero = () => (
	<section className="relative overflow-hidden border-border border-b">
		<div className="dot-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)]" />
		<div className="relative mx-auto w-full max-w-6xl px-5 py-20 sm:py-28">
			<Badge tone="accent">crawl to markdown api</Badge>
			<h1 className="mt-5 max-w-3xl text-balance font-semibold text-4xl leading-[1.08] tracking-tight sm:text-5xl">
				Any URL, converted to Markdown an LLM can actually read.
			</h1>
			<p className="mt-5 max-w-2xl text-lg text-muted-foreground leading-relaxed">
				webforai platform wraps the webforai extraction library in a metered HTTP API. Four acquisition engines — plain
				fetch, proxied fetch, proxied browser, Cloudflare Browser Rendering — behind one request body, with async batch
				and crawl jobs that survive retries.
			</p>
			<div className="mt-8 flex flex-wrap items-center gap-3">
				<Link href="/signup" className={buttonClass("primary", "lg")}>
					Get an API key
				</Link>
				<Link href="/docs" className={buttonClass("outline", "lg")}>
					Read the API reference
				</Link>
			</div>
			<div className="mt-12 max-w-3xl">
				<CodeBlock code={scrapeSnippet} label="curl" />
			</div>
		</div>
	</section>
);

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

const Engines = () => (
	<section className="border-border border-y bg-muted/40">
		<div className="mx-auto w-full max-w-6xl px-5 py-16">
			<h2 className="font-semibold text-2xl tracking-tight">Four acquisition engines</h2>
			<p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
				The engine decides how the HTML is fetched; extraction and Markdown conversion are identical across all of them.
				Pick the cheapest one that gets past the origin.
			</p>
			<div className="mt-8 rounded-xl border border-border bg-card py-2">
				<Table>
					<THead>
						<TR>
							<TH>Engine</TH>
							<TH>Runtime</TH>
							<TH>Proxy</TH>
							<TH>Screenshot</TH>
							<TH className="text-right">Credits</TH>
						</TR>
					</THead>
					<TBody>
						{engines.map((engine) => (
							<TR key={engine.id}>
								<TD className="font-mono text-accent">{engine.id}</TD>
								<TD className="text-muted-foreground">{engine.runtime}</TD>
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

const Pricing = () => (
	<section id="pricing" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-16">
		<h2 className="font-semibold text-2xl tracking-tight">Pricing</h2>
		<p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
			Everything is denominated in credits and metered per successful operation. One counter, no plan matrix.
		</p>
		<div className="mt-8 grid gap-4 md:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>Free allowance</CardTitle>
					<CardDescription>No card required.</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="font-mono text-4xl tabular tracking-tight">500</p>
					<p className="mt-1 text-muted-foreground text-sm">credits per calendar month</p>
					<p className="mt-4 text-muted-foreground text-sm leading-relaxed">
						That is 500 plain-fetch scrapes, or 100 browser-rendered pages. Past the allowance the API answers{" "}
						<code className="font-mono text-accent">402 payment_required</code> until you subscribe.
					</p>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Usage-based</CardTitle>
					<CardDescription>Stripe metered subscription, billed monthly.</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="font-mono text-4xl tabular tracking-tight">$0.002</p>
					<p className="mt-1 text-muted-foreground text-sm">per credit beyond the first 500</p>
					<p className="mt-4 text-muted-foreground text-sm leading-relaxed">
						Graduated tiers on a single Stripe billing meter. Usage is recorded only after an operation succeeds, so
						retries and failures never appear on the invoice.
					</p>
				</CardContent>
			</Card>
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
		<Capabilities />
		<Engines />
		<Pricing />
		<Closing />
	</>
);
