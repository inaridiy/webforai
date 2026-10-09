import { type FormEvent, useEffect, useState } from "react";
import { type DemoResult, type Result, runDemoScrape } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatNumber } from "../../lib/format";
import { useDeploymentOrigin } from "../../lib/links";
import { Link } from "../../lib/router";
import { prefillUrl } from "../../lib/share";
import { Alert } from "../../ui/alert";
import { Button } from "../../ui/button";
import { ClientSnippets, shellArg } from "../client-snippets";
import { MarkdownPanes } from "../markdown-panes";

/**
 * The landing page's hero: one URL through the public `POST /v1/demo/scrape` (fixed `auto`
 * engine, per-IP rate limit, output cut near 40,000 characters), answered with raw Markdown
 * and its rendered preview side by side. The result header states what the request actually
 * did — the engine `auto` resolved to and the size of the output — so the demo doubles as an
 * explanation of the product. A successful run then shows the same request as curl, the
 * TypeScript client and the CLI. The demo has no region choice: Japan egress (`region: "jp"`)
 * runs on the proxy engines, which are paid-plan only.
 */

const INITIAL_URL = "https://en.wikipedia.org/wiki/Markdown";

/** One-click samples; each exercises a different site adapter. */
const EXAMPLES: { label: string; url: string }[] = [
	{ label: "Wikipedia article", url: "https://en.wikipedia.org/wiki/Markdown" },
	{ label: "GitHub README", url: "https://github.com/inaridiy/webforai" },
	{ label: "MDN reference", url: "https://developer.mozilla.org/en-US/docs/Web/HTML" },
	{ label: "Vite docs", url: "https://vite.dev/guide/" },
];

type Failure = Extract<Result<never>, { ok: false }>;

type RunState =
	| { status: "idle" }
	| { status: "running"; startedAt: number }
	| { status: "done"; result: DemoResult; elapsedMs: number }
	| { status: "error"; error: Failure };

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

const hostAndPath = (url: string): string => {
	try {
		const parsed = new URL(url);
		return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
	} catch {
		return url;
	}
};

/** Placeholder line widths for the two result panes while the conversion runs. */
const SKELETON_PANES = [
	{ id: "markdown", widths: [42, 88, 76, 94, 58, 81] },
	{ id: "preview", widths: [64, 97, 85, 71, 90] },
];

const Running = ({ startedAt }: { startedAt: number }) => {
	const [now, setNow] = useState(startedAt);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(performance.now()), 100);
		return () => window.clearInterval(timer);
	}, []);
	const elapsed = now - startedAt;
	return (
		<div className="border-border border-t" aria-live="polite">
			<div className="flex items-center justify-between gap-3 px-5 py-3 text-muted-foreground text-sm">
				<span className="flex items-center gap-2.5">
					<span className="size-2 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
					{elapsed < 4000
						? "Fetching the page"
						: "Rendering it in a browser — this page needs JavaScript or blocks plain fetches"}
				</span>
				<span className="font-mono tabular">{seconds(elapsed)}</span>
			</div>
			<div className="grid grid-cols-1 border-border border-t md:grid-cols-2">
				{SKELETON_PANES.map((pane, index) => (
					<div
						key={pane.id}
						className={cn("space-y-3 px-5 py-5", index === 0 && "border-border border-b md:border-r md:border-b-0")}
					>
						{pane.widths.map((width) => (
							<div
								key={width}
								className="h-2.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
								style={{ width: `${width}%` }}
							/>
						))}
					</div>
				))}
			</div>
		</div>
	);
};

const Done = ({ result, elapsedMs }: { result: DemoResult; elapsedMs: number }) => {
	const rendered = result.engine.includes("browser");
	return (
		<div className="border-border border-t">
			<div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-5 py-3.5">
				<div className="min-w-0">
					<p className="truncate font-medium">{result.title ?? hostAndPath(result.url)}</p>
					<a
						href={result.url}
						target="_blank"
						rel="noreferrer"
						className="block truncate text-muted-foreground text-sm hover:text-foreground"
					>
						{hostAndPath(result.url)}
					</a>
				</div>
				<dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
					<div className="flex items-baseline gap-1.5">
						<dt className="sr-only">Engine</dt>
						<dd
							className={cn(
								"rounded px-1.5 font-mono text-[0.8125rem]",
								rendered ? "bg-accent-subtle text-accent" : "bg-muted text-foreground",
							)}
						>
							auto → {result.engine}
						</dd>
					</div>
					<div className="flex items-baseline gap-1.5 text-muted-foreground">
						<dt>Markdown</dt>
						<dd className="font-mono text-foreground tabular">{formatNumber(result.markdown.length)} chars</dd>
					</div>
					<div className="flex items-baseline gap-1.5 text-muted-foreground">
						<dt>Took</dt>
						<dd className="font-mono text-foreground tabular">{seconds(elapsedMs)}</dd>
					</div>
				</dl>
			</div>
			<MarkdownPanes markdown={result.markdown} className="border-border border-t" />
			{result.truncated ? (
				<p className="border-border border-t bg-muted/60 px-5 py-2.5 text-center text-muted-foreground text-sm">
					The demo returns the first 40,000 characters.{" "}
					<Link href="/signup" className="font-medium text-accent hover:underline">
						Get the whole page with a free API key
					</Link>
				</p>
			) : null}
			<FromYourCode url={result.url} />
		</div>
	);
};

/** The request that produced this result, ready to paste — the step after "that worked". */
const FromYourCode = ({ url }: { url: string }) => {
	const origin = useDeploymentOrigin();
	return (
		<div className="grid gap-5 border-border border-t px-5 py-5 md:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
			<div className="text-sm">
				<h3 className="font-medium">Same page, from your code</h3>
				<p className="mt-1.5 text-muted-foreground leading-relaxed">
					With an API key —{" "}
					<Link href="/signup" className="font-medium text-accent hover:underline">
						free to create
					</Link>{" "}
					— you get the whole page, every engine, batch and crawl.
				</p>
				<p className="mt-3 text-muted-foreground leading-relaxed">
					Free &amp; local, no key:
					<code className="mt-1 block break-all rounded bg-muted px-2 py-1 font-mono text-[0.8125rem] text-foreground">
						npx webforai-cli {shellArg(url)}
					</code>
				</p>
			</div>
			<ClientSnippets origin={origin} url={url} />
		</div>
	);
};

const Failed = ({ error, onRetry }: { error: Failure; onRetry: () => void }) => (
	<div className="border-border border-t p-5">
		{error.status === 429 ? (
			<Alert tone="warning" title="Demo limit reached">
				{error.error}{" "}
				<Link href="/signup" className="font-medium underline">
					A free API key has no demo limit.
				</Link>
			</Alert>
		) : (
			<Alert tone="error" title="Conversion failed">
				<span className="break-words">{error.error}</span>
				<div className="mt-3">
					<Button size="sm" variant="outline" onClick={onRetry}>
						Try again
					</Button>
				</div>
			</Alert>
		)}
	</div>
);

export const DemoConsole = ({ className }: { className?: string }) => {
	const [url, setUrl] = useState(INITIAL_URL);
	const [run, setRun] = useState<RunState>({ status: "idle" });
	const running = run.status === "running";

	// `/?url=…` (the PWA share target, or a link) prefills the field. Read after mount: the
	// prerendered markup, which this hydrates, always carries the default URL.
	useEffect(() => {
		const shared = prefillUrl();
		if (shared !== null) {
			setUrl(shared);
		}
	}, []);

	const convert = (target: string): void => {
		const trimmed = target.trim();
		if (running || trimmed.length === 0) {
			return;
		}
		const startedAt = performance.now();
		setRun({ status: "running", startedAt });
		runDemoScrape(trimmed).then((result) => {
			setRun(
				result.ok
					? { status: "done", result: result.value, elapsedMs: performance.now() - startedAt }
					: { status: "error", error: result },
			);
		});
	};

	const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		convert(url);
	};

	return (
		<div
			id="demo"
			className={cn(
				"scroll-mt-24 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[0_1px_0_0_var(--border),0_12px_32px_-16px_oklch(0.21_0.006_285.885/0.18)]",
				className,
			)}
		>
			<form onSubmit={onSubmit} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
				<label htmlFor="demo-url" className="sr-only">
					URL to convert
				</label>
				<input
					id="demo-url"
					type="url"
					required={true}
					value={url}
					disabled={running}
					onChange={(event) => setUrl(event.target.value)}
					placeholder="https://any-page.example/article"
					className="h-12 w-full min-w-0 rounded-lg border sm:flex-1 sm:w-auto border-border bg-background px-4 font-mono text-base sm:text-[0.9375rem] transition-colors focus:border-accent disabled:opacity-60"
				/>
				<Button type="submit" size="lg" className="h-12 rounded-lg px-6" disabled={running}>
					Convert
				</Button>
			</form>
			<div className="flex flex-wrap items-center gap-1.5 px-4 pb-3.5 text-sm">
				<span className="mr-1 text-muted-foreground">Or try</span>
				{EXAMPLES.map((example) => (
					<button
						key={example.url}
						type="button"
						disabled={running}
						onClick={() => {
							setUrl(example.url);
							convert(example.url);
						}}
						className="rounded-full border border-border px-3 py-1 text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
					>
						{example.label}
					</button>
				))}
			</div>
			{run.status === "running" ? <Running startedAt={run.startedAt} /> : null}
			{run.status === "done" ? <Done result={run.result} elapsedMs={run.elapsedMs} /> : null}
			{run.status === "error" ? <Failed error={run.error} onRetry={() => convert(url)} /> : null}
		</div>
	);
};
