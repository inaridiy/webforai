import type { ReactNode } from "react";
import { Badge } from "../ui/badge";
import { CodeBlock } from "../ui/code-block";

type EndpointSpec = {
	id: string;
	method: "GET" | "POST";
	path: string;
	summary: string;
	notes?: ReactNode;
	request?: { label: string; code: string };
	curl?: string;
	response: { label: string; code: string };
};

const endpoints: EndpointSpec[] = [
	{
		id: "scrape",
		method: "POST",
		path: "/v1/scrape",
		summary: "Synchronous single URL conversion. Runs on a plain Worker — fast, not durable.",
		notes: (
			<>
				With <code className="font-mono text-accent">"async": true</code> the request instead enqueues a one-URL job and
				answers <code className="font-mono text-accent">202 {"{ jobId }"}</code>.
			</>
		),
		request: {
			label: "request",
			code: `{
  "url": "https://example.com/article",
  "engine": "fetch",
  "screenshot": false,
  "rehostImages": false,
  "async": false,
  "convert": {
    "extractor": "auto",
    "frontmatter": true,
    "baseUrl": "https://example.com/"
  }
}`,
		},
		curl: `curl -X POST https://<your-deployment>/v1/scrape \\
  -H "Authorization: Bearer wfa_..." \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com/article","engine":"fetch"}'`,
		response: {
			label: "200 application/json",
			code: `{
  "url": "https://example.com/article",
  "engine": "fetch",
  "markdown": "# Title\\n\\nBody ...",
  "metadata": { "title": "Title" },
  "screenshotUrl": "https://...r2...",
  "images": [{ "original": "https://...", "rehosted": "https://..." }],
  "credits": 1
}`,
		},
	},
	{
		id: "batch",
		method: "POST",
		path: "/v1/batch",
		summary: "Asynchronous conversion of a URL list. Up to 100 URLs per job.",
		request: {
			label: "request",
			code: `{
  "urls": ["https://a.example", "https://b.example"],
  "engine": "fetch",
  "screenshot": false,
  "rehostImages": false,
  "convert": {}
}`,
		},
		curl: `curl -X POST https://<your-deployment>/v1/batch \\
  -H "Authorization: Bearer wfa_..." \\
  -H "Content-Type: application/json" \\
  -d '{"urls":["https://a.example","https://b.example"],"engine":"fetch"}'`,
		response: { label: "202 application/json", code: `{ "jobId": "job_01J..." }` },
	},
	{
		id: "crawl",
		method: "POST",
		path: "/v1/crawl",
		summary: "Asynchronous recursive crawl from a seed URL. Same-origin breadth-first traversal.",
		notes: (
			<>
				Links are read from <code className="font-mono text-accent">&lt;a href&gt;</code> of the fetched HTML before
				extraction, then normalized, fragment-stripped, deduped and same-origin filtered. Limits:{" "}
				<code className="font-mono text-accent">maxDepth ≤ 5</code>,{" "}
				<code className="font-mono text-accent">limit ≤ 500</code>.
			</>
		),
		request: {
			label: "request",
			code: `{
  "url": "https://docs.example.com/",
  "engine": "fetch",
  "maxDepth": 2,
  "limit": 50,
  "includePaths": ["^/docs"],
  "excludePaths": [],
  "sameOrigin": true,
  "screenshot": false,
  "rehostImages": false,
  "convert": {}
}`,
		},
		response: { label: "202 application/json", code: `{ "jobId": "job_01J..." }` },
	},
	{
		id: "job",
		method: "GET",
		path: "/v1/jobs/:id",
		summary: "Job status for batch and crawl runs.",
		response: {
			label: "200 application/json",
			code: `{
  "jobId": "job_01J...",
  "type": "crawl",
  "status": "running",
  "total": 50,
  "completed": 12,
  "failed": 1,
  "credits": 13,
  "expiresAt": "2026-09-01T00:00:00.000Z"
}`,
		},
	},
	{
		id: "job-results",
		method: "GET",
		path: "/v1/jobs/:id/results?cursor=...",
		summary: "Paged per-page results. Each item mirrors the scrape response plus a per-page status.",
		notes: <>Large Markdown payloads are replaced by an expiring R2 URL under a resultUrl field.</>,
		response: {
			label: "200 application/json",
			code: `{
  "items": [
    {
      "status": "ok",
      "url": "https://docs.example.com/intro",
      "engine": "fetch",
      "markdown": "# Intro\\n...",
      "metadata": { "title": "Intro" },
      "credits": 1
    },
    {
      "status": "error",
      "url": "https://docs.example.com/private",
      "error": { "code": "fetch_failed", "message": "403 Forbidden" }
    }
  ],
  "cursor": "eyJvIjoyMH0"
}`,
		},
	},
];

const methodTone = (method: EndpointSpec["method"]) => (method === "GET" ? "accent" : "success");

const Endpoint = ({ spec }: { spec: EndpointSpec }) => (
	<section id={spec.id} className="scroll-mt-20 border-border border-t py-10 first:border-t-0">
		<div className="flex flex-wrap items-center gap-3">
			<Badge tone={methodTone(spec.method)}>{spec.method}</Badge>
			<h2 className="font-mono font-medium text-lg tracking-tight">{spec.path}</h2>
		</div>
		<p className="mt-3 max-w-3xl text-muted-foreground text-sm leading-relaxed">{spec.summary}</p>
		{spec.notes === undefined ? null : (
			<p className="mt-2 max-w-3xl text-muted-foreground text-sm leading-relaxed">{spec.notes}</p>
		)}
		<div className="mt-5 flex flex-col gap-3">
			{spec.request === undefined ? null : <CodeBlock label={spec.request.label} code={spec.request.code} />}
			{spec.curl === undefined ? null : <CodeBlock label="curl" code={spec.curl} />}
			<CodeBlock label={spec.response.label} code={spec.response.code} />
		</div>
	</section>
);

const Intro = () => (
	<section className="pb-4">
		<p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider">API reference</p>
		<h1 className="mt-1 font-semibold text-3xl tracking-tight">Data API</h1>
		<p className="mt-3 max-w-3xl text-muted-foreground leading-relaxed">
			Every endpoint takes and returns JSON. Authenticate with an API key minted in the dashboard; the dashboard's own
			endpoints use the session cookie instead.
		</p>
		<div className="mt-6 flex flex-col gap-3">
			<CodeBlock label="authentication" code="Authorization: Bearer wfa_..." />
			<CodeBlock
				label="error envelope"
				code={`{ "error": { "code": "payment_required", "message": "Free allowance exhausted" } }`}
			/>
		</div>
	</section>
);

const Rules = () => (
	<section id="rules" className="scroll-mt-20 border-border border-t py-10">
		<h2 className="font-semibold text-xl tracking-tight">Behaviour</h2>
		<ul className="mt-4 flex max-w-3xl list-disc flex-col gap-2 pl-5 text-muted-foreground text-sm leading-relaxed">
			<li>
				The billing guard runs before any side effect; usage is recorded only after success, per page for async jobs.
			</li>
			<li>
				SSRF guard: public http(s) URLs only. Private ranges, localhost and non-standard ports are rejected at
				validation time for every engine, and re-checked on redirect targets inside the container fetcher.
			</li>
			<li>Per-key rate limiting applies on top of the job-level caps (100 URLs per batch, 500 pages per crawl).</li>
			<li>
				<code className="font-mono text-accent">screenshot: true</code> is only valid for{" "}
				<code className="font-mono text-accent">proxy-browser</code> and{" "}
				<code className="font-mono text-accent">cf-browser</code>; other engines answer 400.
			</li>
		</ul>
	</section>
);

const DashboardApi = () => (
	<section id="dashboard-api" className="scroll-mt-20 border-border border-t py-10">
		<h2 className="font-semibold text-xl tracking-tight">Dashboard API</h2>
		<p className="mt-3 max-w-3xl text-muted-foreground text-sm leading-relaxed">
			Session-cookie endpoints used by this SPA. They are not part of the public data API and take no API key.
		</p>
		<div className="mt-5 flex flex-col gap-3">
			<CodeBlock
				label="GET /api/dashboard/usage"
				code={`{
  "monthCredits": 128,
  "freeAllowance": 500,
  "billingEnabled": true,
  "subscriptionStatus": "none",
  "recentEvents": [
    { "id": "01J...", "operation": "scrape:fetch", "credits": 1, "createdAt": "2026-08-10T09:12:00.000Z" }
  ]
}`}
			/>
			<CodeBlock
				label="POST /api/dashboard/billing/checkout"
				code={`{ "url": "https://checkout.stripe.com/c/pay/..." }`}
			/>
			<CodeBlock
				label="POST /api/dashboard/billing/portal"
				code={`{ "url": "https://billing.stripe.com/p/session/..." }`}
			/>
		</div>
	</section>
);

const tocItems: { id: string; label: string }[] = [
	...endpoints.map((endpoint) => ({ id: endpoint.id, label: `${endpoint.method} ${endpoint.path}` })),
	{ id: "rules", label: "Behaviour" },
	{ id: "dashboard-api", label: "Dashboard API" },
];

export const DocsPage = () => (
	<div className="mx-auto w-full max-w-6xl px-5 py-10">
		<div className="flex gap-10">
			<nav className="sticky top-20 hidden h-fit w-56 shrink-0 flex-col gap-1 lg:flex">
				{tocItems.map((item) => (
					<a
						key={item.id}
						href={`#${item.id}`}
						className="truncate rounded px-2 py-1 font-mono text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
					>
						{item.label}
					</a>
				))}
			</nav>
			<div className="min-w-0 flex-1">
				<Intro />
				{endpoints.map((spec) => (
					<Endpoint key={spec.id} spec={spec} />
				))}
				<Rules />
				<DashboardApi />
			</div>
		</div>
	</div>
);
