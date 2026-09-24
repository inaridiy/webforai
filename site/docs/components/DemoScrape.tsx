import { type FormEvent, useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import { PLATFORM_DEMO_ENDPOINT, PLATFORM_ORIGIN, PLATFORM_REGIONS, type PlatformRegion } from "./platform";
import "streamdown/styles.css";

type DemoSuccess = {
	url: string;
	region: PlatformRegion;
	/** What `auto` resolved to; absent from platform deployments older than 2026-09-24. */
	engine?: string;
	markdown: string;
	truncated: boolean;
	title?: string;
	metadata?: { title?: string; description?: string } | null;
};

type DemoErrorBody = {
	error?: { code?: string; message?: string; retryAfter?: number };
};

type RunState =
	| { status: "idle" }
	| { status: "running"; startedAt: number }
	| { status: "done"; result: DemoSuccess; elapsedMs: number }
	| { status: "error"; kind: "rate_limited" | "failed"; message: string };

type View = "split" | "markdown" | "preview";

const DEFAULT_URL = "https://en.wikipedia.org/wiki/Markdown";

/** One-click samples, each exercising a different site adapter. */
const EXAMPLES: { label: string; url: string }[] = [
	{ label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Markdown" },
	{ label: "GitHub README", url: "https://github.com/inaridiy/webforai" },
	{ label: "MDN", url: "https://developer.mozilla.org/en-US/docs/Web/HTML" },
	{ label: "Vite docs", url: "https://vite.dev/guide/" },
];

const REGION_LABELS: Record<PlatformRegion, string> = {
	auto: "Region: auto",
	us: "United States",
	eu: "Europe",
	uk: "United Kingdom",
	jp: "Japan",
	asia: "Asia",
};

const ENGINE_LABELS: Record<string, string> = {
	fetch: "plain fetch",
	browser: "rendered in a browser",
	"proxy-fetch": "fetch via proxy",
	"proxy-browser": "browser via proxy",
};

/**
 * This site is on React 18 while streamdown's typings resolve against the workspace's
 * hoisted `@types/react` 19, so TS rejects it as a JSX component even though the runtime
 * is compatible (streamdown declares `react: ^18 || ^19`). Narrow cast over the props
 * this file actually uses.
 */
const StreamdownPreview = Streamdown as unknown as (props: {
	children?: string;
	className?: string;
	controls?: boolean;
}) => JSX.Element;

/**
 * Streamdown has no frontmatter support, and raw remark renders a leading `---` block as a
 * broken mix of headings and rules — so drop it from the preview (the raw pane shows it).
 */
const stripFrontmatter = (markdown: string): string => {
	const match = /^---\n[\s\S]*?\n---\n?/.exec(markdown);
	return match === null ? markdown : markdown.slice(match[0].length);
};

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

const formatSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

const displayUrl = (url: string): string => {
	try {
		const parsed = new URL(url);
		return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
	} catch {
		return url;
	}
};

const formatRetryAfter = (seconds: number | undefined): string => {
	if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
		return "in a little while";
	}
	if (seconds < 60) {
		return `in ${Math.ceil(seconds)}s`;
	}
	return `in about ${Math.ceil(seconds / 60)} min`;
};

const readRetryAfter = (response: Response, body: DemoErrorBody): number | undefined => {
	const fromBody = body.error?.retryAfter;
	if (typeof fromBody === "number") {
		return fromBody;
	}
	const header = Number(response.headers.get("Retry-After"));
	return Number.isFinite(header) ? header : undefined;
};

const runDemo = async (url: string, region: PlatformRegion, startedAt: number): Promise<RunState> => {
	let response: Response;
	try {
		response = await fetch(PLATFORM_DEMO_ENDPOINT, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ url, region }),
		});
	} catch {
		return { status: "error", kind: "failed", message: "Could not reach the demo API. Check your connection." };
	}
	const body = (await response.json().catch(() => ({}))) as DemoErrorBody & Partial<DemoSuccess>;
	if (response.status === 429) {
		const retry = formatRetryAfter(readRetryAfter(response, body));
		return {
			status: "error",
			kind: "rate_limited",
			message: `The public demo allows 5 conversions per 10 minutes. Try again ${retry}.`,
		};
	}
	if (!response.ok) {
		return {
			status: "error",
			kind: "failed",
			message: body.error?.message ?? `Request failed with status ${response.status}.`,
		};
	}
	return {
		status: "done",
		elapsedMs: performance.now() - startedAt,
		result: {
			url: body.url ?? url,
			region: body.region ?? region,
			engine: body.engine,
			markdown: body.markdown ?? "",
			truncated: body.truncated ?? false,
			title: body.title ?? body.metadata?.title,
			metadata: body.metadata ?? null,
		},
	};
};

// --- pieces ---------------------------------------------------------------------------------

const PaneLabel = ({ children }: { children: string }) => (
	<div className="flex h-8 items-center border-border border-b bg-muted/60 px-4 font-mono text-[11px] text-muted-foreground uppercase tracking-wider">
		{children}
	</div>
);

const Skeleton = ({ widths }: { widths: number[] }) => (
	<div className="space-y-3 px-4 py-4">
		{widths.map((width) => (
			<div key={width} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${width}%` }} />
		))}
	</div>
);

const Elapsed = ({ startedAt }: { startedAt: number }) => {
	const [now, setNow] = useState(startedAt);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(performance.now()), 100);
		return () => window.clearInterval(timer);
	}, []);
	const elapsed = now - startedAt;
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 border-border border-b px-4 py-3 text-[13px] text-muted-foreground">
			<span className="flex items-center gap-2">
				<span className="size-2 animate-pulse rounded-full bg-accent" />
				{elapsed < 4000
					? "Fetching and converting…"
					: "Still working — pages that need JavaScript are rendered in a real browser first."}
			</span>
			<span className="font-mono tabular-nums">{formatSeconds(elapsed)}</span>
		</div>
	);
};

const ViewToggle = ({ view, onChange }: { view: View; onChange: (view: View) => void }) => (
	<div role="tablist" aria-label="Result view" className="flex rounded-md border border-border bg-muted/60 p-0.5">
		{(["split", "markdown", "preview"] as const).map((option) => (
			<button
				key={option}
				type="button"
				role="tab"
				aria-selected={view === option}
				onClick={() => onChange(option)}
				className={`rounded px-2.5 py-1 text-[12px] capitalize transition-colors ${
					view === option
						? "bg-card font-medium text-foreground shadow-sm"
						: "text-muted-foreground hover:text-foreground"
				}`}
			>
				{option}
			</button>
		))}
	</div>
);

const CopyButton = ({ text }: { text: string }) => {
	const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
	const copy = () => {
		navigator.clipboard
			.writeText(text)
			.then(() => setState("copied"))
			.catch(() => setState("failed"))
			.finally(() => window.setTimeout(() => setState("idle"), 1600));
	};
	const label = { idle: "Copy Markdown", copied: "Copied", failed: "Copy failed" }[state];
	return (
		<button
			type="button"
			onClick={copy}
			className="whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1 font-medium text-[12px] transition-colors hover:bg-muted"
		>
			{label}
		</button>
	);
};

const ResultView = ({ result, elapsedMs }: { result: DemoSuccess; elapsedMs: number }) => {
	const [view, setView] = useState<View>("split");
	const body = stripFrontmatter(result.markdown);
	const chars = result.markdown.length;
	const engineLabel = result.engine === undefined ? undefined : ENGINE_LABELS[result.engine] ?? result.engine;
	const rendered = result.engine?.includes("browser") === true;

	return (
		<>
			<div className="flex flex-wrap items-start justify-between gap-3 border-border border-b px-4 py-3">
				<div className="min-w-0">
					<div className="truncate font-medium text-[15px] text-foreground">
						{result.title ?? displayUrl(result.url)}
					</div>
					<a
						href={result.url}
						target="_blank"
						rel="noreferrer"
						className="block truncate text-[13px] text-muted-foreground hover:text-foreground"
					>
						{displayUrl(result.url)} ↗
					</a>
					<div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[12px] text-muted-foreground">
						{engineLabel ? (
							<span className={`rounded px-1.5 ${rendered ? "bg-accent/10 text-accent" : "bg-muted text-foreground"}`}>
								auto → {engineLabel}
							</span>
						) : null}
						<span>{compact.format(chars)} chars</span>
						<span>≈{compact.format(Math.round(chars / 4))} tokens</span>
						<span>{formatSeconds(elapsedMs)}</span>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<ViewToggle view={view} onChange={setView} />
					<CopyButton text={result.markdown} />
				</div>
			</div>
			<div className={`grid grid-cols-1 ${view === "split" ? "md:grid-cols-2" : ""}`}>
				{view === "preview" ? null : (
					<div className={`min-w-0 ${view === "split" ? "border-border border-b md:border-r md:border-b-0" : ""}`}>
						<PaneLabel>markdown</PaneLabel>
						<pre className="m-0 max-h-[360px] md:max-h-[560px] overflow-auto whitespace-pre-wrap break-words bg-transparent px-4 py-3 font-mono text-[12.5px] leading-relaxed">
							{/* Sized on the element itself: vocs styles bare `code` globally. */}
							<code className="bg-transparent p-0 font-mono text-[12.5px] leading-relaxed">
								{result.markdown || "(empty result)"}
							</code>
						</pre>
					</div>
				)}
				{view === "markdown" ? null : (
					<div className="min-w-0">
						<PaneLabel>preview</PaneLabel>
						<div className="max-h-[360px] md:max-h-[560px] overflow-auto px-5 py-4">
							<StreamdownPreview className="md-preview" controls={false}>
								{body}
							</StreamdownPreview>
						</div>
					</div>
				)}
			</div>
			{result.truncated ? (
				<div className="border-border border-t bg-muted/60 px-4 py-2.5 text-center text-[13px] text-muted-foreground">
					The demo returns the first ~8,000 characters.{" "}
					<a href={`${PLATFORM_ORIGIN}/signup`} className="font-medium text-accent">
						Get the full page with a free API key →
					</a>
				</div>
			) : null}
		</>
	);
};

const ErrorView = ({
	kind,
	message,
	onRetry,
}: { kind: "rate_limited" | "failed"; message: string; onRetry: () => void }) =>
	kind === "rate_limited" ? (
		<div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
			<div className="font-medium text-[15px] text-foreground">Demo limit reached</div>
			<p className="max-w-md text-[14px] text-muted-foreground">{message}</p>
			<a
				href={`${PLATFORM_ORIGIN}/signup`}
				className="mt-2 rounded-lg bg-accent px-4 py-2 font-medium text-[14px] text-accent-foreground hover:opacity-90"
			>
				Create a free account — 500 credits / month
			</a>
		</div>
	) : (
		<div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
			<div className="font-medium text-[15px] text-destructive">Conversion failed</div>
			<p className="max-w-md break-words text-[14px] text-muted-foreground">{message}</p>
			<button
				type="button"
				onClick={onRetry}
				className="mt-2 rounded-lg border border-border bg-card px-4 py-2 font-medium text-[14px] hover:bg-muted"
			>
				Try again
			</button>
		</div>
	);

// --- component ------------------------------------------------------------------------------

/**
 * The landing page's live demo against the platform's public `POST /v1/demo/scrape`: one
 * URL (or an example), raw Markdown next to its rendered preview, with the engine `auto`
 * picked and rough size figures so visitors can judge the output before signing up.
 */
export const DemoScrape = () => {
	const [url, setUrl] = useState(DEFAULT_URL);
	const [region, setRegion] = useState<PlatformRegion>("auto");
	const [run, setRun] = useState<RunState>({ status: "idle" });
	const running = run.status === "running";

	const convert = (target: string) => {
		const trimmed = target.trim();
		if (running || trimmed.length === 0) {
			return;
		}
		const startedAt = performance.now();
		setRun({ status: "running", startedAt });
		runDemo(trimmed, region, startedAt)
			.then(setRun)
			.catch(() => setRun({ status: "error", kind: "failed", message: "Something went wrong. Please try again." }));
	};

	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		convert(url);
	};

	return (
		<div className="mt-4 overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-sm">
			<form onSubmit={onSubmit} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
				<label className="sr-only" htmlFor="demo-url">
					URL to convert
				</label>
				<input
					id="demo-url"
					type="url"
					required={true}
					value={url}
					disabled={running}
					onChange={(event) => setUrl(event.target.value)}
					placeholder="https://any-page-you-like.com/article"
					className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[14px] outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
				/>
				<label className="sr-only" htmlFor="demo-region">
					Egress region
				</label>
				<select
					id="demo-region"
					value={region}
					disabled={running}
					onChange={(event) => setRegion(event.target.value as PlatformRegion)}
					className="rounded-lg border border-border bg-background px-3 py-2.5 text-[14px] outline-none focus:border-accent disabled:opacity-60"
				>
					{PLATFORM_REGIONS.map((value) => (
						<option key={value} value={value}>
							{REGION_LABELS[value]}
						</option>
					))}
				</select>
				<button
					type="submit"
					disabled={running || url.trim().length === 0}
					className="rounded-lg bg-accent px-5 py-2.5 font-medium text-[14px] text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{running ? "Converting…" : "Convert →"}
				</button>
			</form>
			<div className="flex flex-wrap items-center gap-1.5 px-3 pb-3 text-[13px]">
				<span className="mr-1 text-muted-foreground">Examples:</span>
				{EXAMPLES.map((example) => (
					<button
						key={example.url}
						type="button"
						disabled={running}
						onClick={() => {
							setUrl(example.url);
							convert(example.url);
						}}
						className="rounded-full border border-border bg-background px-2.5 py-0.5 text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
					>
						{example.label}
					</button>
				))}
			</div>

			<div className="border-border border-t">
				{run.status === "idle" ? (
					<div className="flex flex-col items-center gap-1.5 bg-muted/40 px-6 py-14 text-center">
						<div className="font-medium text-[15px]">Any URL in, clean Markdown out</div>
						<p className="max-w-md text-[14px] text-muted-foreground">
							Press Convert or pick an example — the Markdown and its rendered preview appear side by side. Navigation,
							ads and cookie banners are stripped; pages that need JavaScript are rendered first.
						</p>
					</div>
				) : null}
				{run.status === "running" ? (
					<>
						<Elapsed startedAt={run.startedAt} />
						<div className="grid grid-cols-1 md:grid-cols-2">
							<div className="border-border border-b md:border-r md:border-b-0">
								<PaneLabel>markdown</PaneLabel>
								<Skeleton widths={[45, 90, 80, 95, 60, 85, 70]} />
							</div>
							<div>
								<PaneLabel>preview</PaneLabel>
								<Skeleton widths={[60, 100, 90, 75, 95, 50]} />
							</div>
						</div>
					</>
				) : null}
				{run.status === "done" ? <ResultView result={run.result} elapsedMs={run.elapsedMs} /> : null}
				{run.status === "error" ? (
					<ErrorView kind={run.kind} message={run.message} onRetry={() => convert(url)} />
				) : null}
			</div>

			<div className="border-border border-t bg-muted/40 px-4 py-2 text-[12px] text-muted-foreground">
				Public demo · 5 conversions / 10 min · <span className="font-mono">auto</span> engine · no API key needed ·{" "}
				<a href={`${PLATFORM_ORIGIN}/signup`} className="text-accent">
					free account: 500 credits / month →
				</a>
			</div>
		</div>
	);
};
