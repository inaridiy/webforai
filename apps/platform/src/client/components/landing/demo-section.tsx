import { type FormEvent, useState } from "react";
import { type DemoResult, type Result, runDemoScrape } from "../../lib/api";
import { Link } from "../../lib/router";
import { Alert } from "../../ui/alert";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, type SelectOption } from "../../ui/select";
import { LoadingRow, Spinner } from "../../ui/spinner";
import { MarkdownPanes } from "../markdown-panes";

/**
 * The public top-page demo: one URL through the unauthenticated `POST /v1/demo/scrape`
 * (fixed `auto` engine, per-IP rate limit, truncated output), shown as raw Markdown
 * and a rendered preview side by side (`MarkdownPanes`, shared with the playground).
 */

const INITIAL_URL = "https://platform.webforai.dev";

const REGION_OPTIONS: SelectOption[] = [
	{ value: "auto", label: "auto (nearest)" },
	{ value: "us", label: "United States" },
	{ value: "eu", label: "Europe" },
	{ value: "uk", label: "United Kingdom" },
	{ value: "jp", label: "Japan" },
	{ value: "asia", label: "Asia" },
];

type RunState =
	| { status: "idle" }
	| { status: "running" }
	| { status: "done"; result: DemoResult }
	| { status: "error"; error: Extract<Result<never>, { ok: false }> };

const DemoResultView = ({ result }: { result: DemoResult }) => {
	return (
		<>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-border border-t px-5 py-2.5 text-muted-foreground text-xs">
				<span className="min-w-0 truncate font-medium text-foreground text-sm">{result.title ?? result.url}</span>
				<span className="rounded bg-muted px-1.5 font-mono text-foreground">auto → {result.engine}</span>
				<span className="font-mono">{result.markdown.length.toLocaleString("en")} chars</span>
			</div>
			<MarkdownPanes markdown={result.markdown} className="border-border border-t" />
			{result.truncated ? (
				<div className="border-border border-t bg-muted/60 px-5 py-2 text-center text-muted-foreground text-xs">
					Demo output is truncated —{" "}
					<Link href="/signup" className="text-accent hover:underline">
						create an account
					</Link>{" "}
					for full results and every engine.
				</div>
			) : null}
		</>
	);
};

const DemoError = ({ error }: { error: Extract<Result<never>, { ok: false }> }) => (
	<div className="border-border border-t p-4 sm:p-5">
		{error.status === 429 ? (
			<Alert tone="warning" title="Rate limited">
				{error.error}
			</Alert>
		) : (
			<Alert tone="error" title="Conversion failed">
				{error.error}
			</Alert>
		)}
	</div>
);

export const DemoSection = () => {
	const [url, setUrl] = useState(INITIAL_URL);
	const [region, setRegion] = useState("auto");
	const [run, setRun] = useState<RunState>({ status: "idle" });

	const running = run.status === "running";

	const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		if (running || url.trim().length === 0) {
			return;
		}
		setRun({ status: "running" });
		runDemoScrape(url.trim(), region).then((result) => {
			setRun(result.ok ? { status: "done", result: result.value } : { status: "error", error: result });
		});
	};

	return (
		<section id="demo" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 pt-16">
			<span className="font-mono text-[0.6875rem] text-accent uppercase tracking-wider">Live demo</span>
			<h2 className="mt-2 font-semibold text-2xl tracking-tight">Try it on any URL</h2>
			<p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
				The same conversion pipeline as <span className="font-mono">POST /v1/scrape</span>, running the{" "}
				<span className="font-mono">auto</span> engine — plain fetch, escalating to browser rendering when the page
				needs JavaScript. No account needed — rate-limited to 5 requests per 10 minutes.
			</p>
			<div className="mt-6 overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
				<form onSubmit={onSubmit} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5">
					<div className="w-full min-w-0 sm:flex-1">
						<Input
							aria-label="URL to convert"
							type="url"
							className="font-mono text-[0.8125rem]"
							value={url}
							disabled={running}
							onChange={(event) => setUrl(event.target.value)}
							placeholder="https://example.com"
						/>
					</div>
					<div className="w-full sm:w-[11rem]">
						<Select
							aria-label="Egress region"
							className="font-mono text-[0.8125rem]"
							options={REGION_OPTIONS}
							value={region}
							disabled={running}
							onChange={(event) => setRegion(event.target.value)}
						/>
					</div>
					<Button type="submit" className="sm:px-6" disabled={running || url.trim().length === 0}>
						{running ? (
							<>
								<Spinner />
								Converting
							</>
						) : (
							"Convert"
						)}
					</Button>
				</form>
				{run.status === "idle" ? (
					<div className="flex flex-col items-center gap-1.5 border-border border-t bg-muted/40 px-5 pt-12 pb-14 text-center">
						<p className="font-medium text-foreground text-sm">No conversion yet</p>
						<p className="text-[0.8125rem] text-muted-foreground">
							Paste a URL and press Convert — the Markdown and a rendered preview appear side by side.
						</p>
					</div>
				) : null}
				{run.status === "running" ? (
					<div className="border-border border-t px-5">
						<LoadingRow label="Converting" />
					</div>
				) : null}
				{run.status === "error" ? <DemoError error={run.error} /> : null}
				{run.status === "done" ? <DemoResultView result={run.result} /> : null}
			</div>
		</section>
	);
};
