import { useEffect, useMemo, useState } from "react";
import { ENGINE_CREDITS } from "../../billing/credits";
import { MarkdownPanes } from "../components/markdown-panes";
import { type PlaygroundRequest, type PlaygroundResult, type Result, runPlaygroundScrape } from "../lib/api";
import { cn } from "../lib/cn";
import { copyToClipboard } from "../lib/format";
import { Link, navigate } from "../lib/router";
import type { SessionState } from "../lib/use-session";
import { Alert } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Field, Input } from "../ui/input";
import { Select, type SelectOption } from "../ui/select";
import { LoadingRow, Spinner } from "../ui/spinner";

const ENGINE_OPTIONS: SelectOption[] = [
	{ value: "auto", label: "auto" },
	{ value: "fetch", label: "fetch" },
	{ value: "browser", label: "browser" },
	{ value: "proxy-fetch", label: "proxy-fetch" },
	{ value: "proxy-browser", label: "proxy-browser" },
];

/** Shown under the engine select so the cost is visible before pressing Run. */
const credits = (engine: keyof typeof ENGINE_CREDITS): string =>
	`${ENGINE_CREDITS[engine]} credit${ENGINE_CREDITS[engine] === 1 ? "" : "s"}`;

const ENGINE_HINTS: Record<string, string> = {
	auto: `Cheapest first, renders when the page needs JavaScript or blocks fetches · ${ENGINE_CREDITS.fetch}–${ENGINE_CREDITS.browser} credits (${ENGINE_CREDITS["proxy-fetch"]}–${ENGINE_CREDITS["proxy-browser"]} with a region)`,
	fetch: `Plain fetch · ${credits("fetch")}`,
	browser: `Browser rendering · ${credits("browser")}`,
	// biome-ignore lint/style/useNamingConvention: engine ids are kebab-case API values
	"proxy-fetch": `Rotating-proxy egress · ${credits("proxy-fetch")}`,
	// biome-ignore lint/style/useNamingConvention: engine ids are kebab-case API values
	"proxy-browser": `Headless browser via proxy · ${credits("proxy-browser")}`,
};

const REGION_OPTIONS: SelectOption[] = [
	{ value: "auto", label: "auto" },
	{ value: "jp", label: "jp" },
];

const EXTRACTOR_OPTIONS: SelectOption[] = [
	{ value: "auto", label: "auto" },
	{ value: "takumi", label: "takumi" },
	{ value: "minimal", label: "minimal" },
	{ value: "none", label: "none" },
];

// `auto` renders in a browser when asked for a screenshot, and pins to the proxy tier when a
// region is set — so both toggles stay live for it.
const SCREENSHOT_ENGINES = new Set(["auto", "browser", "proxy-browser"]);
const PROXY_ENGINES = new Set(["auto", "proxy-fetch", "proxy-browser"]);

type FormState = {
	url: string;
	engine: string;
	region: string;
	extractor: string;
	frontmatter: boolean;
	screenshot: boolean;
	rehostImages: boolean;
	respectRobotsTxt: boolean;
};

const INITIAL_FORM: FormState = {
	url: "https://example.com",
	engine: "auto",
	region: "auto",
	extractor: "auto",
	frontmatter: true,
	screenshot: false,
	rehostImages: false,
	respectRobotsTxt: false,
};

const buildRequest = (form: FormState): PlaygroundRequest => ({
	url: form.url,
	engine: form.engine,
	screenshot: form.screenshot,
	rehostImages: form.rehostImages,
	region: form.region,
	// Opt-in and off by default; only sent (and shown in the curl sample) when checked.
	...(form.respectRobotsTxt ? { respectRobotsTxt: true } : {}),
	convert: { extractor: form.extractor, frontmatter: form.frontmatter },
});

/** The exact JSON body the form would send, pretty-printed for the copyable curl sample. */
const equivalentCurl = (form: FormState): string => {
	const origin = typeof window === "undefined" ? "https://<your-deployment>" : window.location.origin;
	const body = JSON.stringify(buildRequest(form), null, 2)
		.split("\n")
		.map((line, index) => (index === 0 ? line : `  ${line}`))
		.join("\n");
	return `curl -X POST ${origin}/v1/scrape \\
  -H "Authorization: Bearer wfa_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${body}'`;
};

const metadataTitle = (metadata: Record<string, unknown>): string | undefined => {
	const title = metadata.title;
	return typeof title === "string" && title.length > 0 ? title : undefined;
};

const Checkbox = ({
	id,
	label,
	hint,
	checked,
	disabled,
	onChange,
}: {
	id: string;
	label: string;
	hint?: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (checked: boolean) => void;
}) => (
	<label htmlFor={id} className="flex items-start gap-2.5" data-disabled={disabled}>
		<input
			id={id}
			type="checkbox"
			checked={checked}
			disabled={disabled}
			onChange={(event) => onChange(event.target.checked)}
			className="mt-0.5 size-4 shrink-0 rounded border-border accent-primary disabled:opacity-50"
		/>
		<span className={disabled ? "opacity-50" : undefined}>
			<span className="font-medium text-foreground text-sm">{label}</span>
			{hint === undefined ? null : <span className="block text-muted-foreground text-xs">{hint}</span>}
		</span>
	</label>
);

const RunError = ({ error }: { error: Extract<Result<never>, { ok: false }> }) => {
	if (error.status === 402) {
		return (
			<Alert tone="warning" title="Out of credits">
				<div className="flex flex-col gap-2">
					<p>{error.error}</p>
					<div>
						<Link href="/dashboard" className="font-medium underline hover:no-underline">
							Upgrade on the dashboard
						</Link>
					</div>
				</div>
			</Alert>
		);
	}
	if (error.status === 503) {
		return (
			<Alert tone="error" title="Engine unavailable">
				This engine is not configured on this deployment (the proxy or browser binding is missing). Try the{" "}
				<span className="font-mono">fetch</span> engine.
			</Alert>
		);
	}
	if (error.status === 400) {
		return (
			<Alert tone="error" title="Invalid request">
				{error.error}
			</Alert>
		);
	}
	if (error.status === 0) {
		return (
			<Alert tone="error" title="Network error">
				{error.error}
			</Alert>
		);
	}
	return (
		<Alert tone="error" title="Scrape failed">
			{error.error}
		</Alert>
	);
};

const ResultView = ({ result }: { result: PlaygroundResult }) => {
	const title = metadataTitle(result.metadata);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<Badge tone="success">
					{result.credits} credit{result.credits === 1 ? "" : "s"} used
				</Badge>
				<Badge tone="neutral">{result.engine}</Badge>
				{title === undefined ? null : <span className="font-medium text-foreground text-sm">{title}</span>}
			</div>
			{result.warning === undefined ? null : (
				<Alert tone="warning" title="Degraded result">
					{result.warning}
				</Alert>
			)}
			{result.screenshotUrl === undefined ? null : (
				<Card>
					<CardHeader>
						<CardTitle>Screenshot</CardTitle>
					</CardHeader>
					<CardContent>
						<img
							src={result.screenshotUrl}
							alt="Rendered page screenshot"
							className="max-h-[32rem] w-full rounded-md border border-border object-contain"
						/>
					</CardContent>
				</Card>
			)}
			<div className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
				<MarkdownPanes markdown={result.markdown} />
			</div>
			{result.images === undefined || result.images.length === 0 ? null : (
				<Card>
					<CardHeader>
						<CardTitle>Rehosted images ({result.images.length})</CardTitle>
					</CardHeader>
					<CardContent>
						<ul className="flex flex-col gap-2 text-sm">
							{result.images.map((image) => (
								<li key={image.original} className="flex flex-col gap-0.5 break-all">
									<a
										href={image.rehosted}
										className="font-mono text-accent text-xs hover:underline"
										rel="noreferrer"
										target="_blank"
									>
										{image.rehosted}
									</a>
									<span className="font-mono text-muted-foreground text-xs">from {image.original}</span>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			)}
		</div>
	);
};

type RunState =
	| { status: "idle" }
	| { status: "running" }
	| { status: "done"; result: PlaygroundResult }
	| { status: "error"; error: Extract<Result<never>, { ok: false }> };

const CurlStrip = ({ curl }: { curl: string }) => {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);

	const onCopy = (): void => {
		copyToClipboard(curl).then((success) => {
			setCopied(success);
			window.setTimeout(() => setCopied(false), 1600);
		});
	};

	return (
		<>
			<div className="flex items-center justify-between gap-3 border-border border-t bg-muted/60 py-1.5 pr-2 pl-5">
				<span className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider">
					Equivalent API request · curl
				</span>
				<div className="flex items-center gap-1">
					{open ? (
						<button
							type="button"
							onClick={onCopy}
							className="rounded px-1.5 py-1 font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider hover:text-foreground"
						>
							{copied ? "copied" : "copy"}
						</button>
					) : null}
					<button
						type="button"
						onClick={() => setOpen((value) => !value)}
						className="rounded px-1.5 py-1 font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider hover:text-foreground"
					>
						{open ? "hide" : "show"}
					</button>
				</div>
			</div>
			{open ? (
				<pre className="overflow-x-auto border-border/70 border-t px-5 py-3 font-mono text-[0.8125rem] leading-relaxed">
					<code>{curl}</code>
				</pre>
			) : null}
		</>
	);
};

const PlaygroundBody = () => {
	const [form, setForm] = useState<FormState>(INITIAL_FORM);
	const [run, setRun] = useState<RunState>({ status: "idle" });

	const screenshotAllowed = SCREENSHOT_ENGINES.has(form.engine);
	const regionApplies = PROXY_ENGINES.has(form.engine);

	const update = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
		setForm((prev) => ({ ...prev, [key]: value }));

	// A screenshot on a non-browser engine is a 400, so drop the flag the moment it can't apply.
	const onEngineChange = (engine: string): void =>
		setForm((prev) => ({ ...prev, engine, screenshot: SCREENSHOT_ENGINES.has(engine) ? prev.screenshot : false }));

	const curl = useMemo(() => equivalentCurl(form), [form]);

	const onRun = (): void => {
		setRun({ status: "running" });
		runPlaygroundScrape(buildRequest(form)).then((result) => {
			setRun(result.ok ? { status: "done", result: result.value } : { status: "error", error: result });
		});
	};

	const running = run.status === "running";

	return (
		<div className="mx-auto w-full max-w-6xl px-5 py-10">
			<header className="mb-6">
				<h1 className="font-semibold text-2xl tracking-tight">Playground</h1>
				<p className="mt-2 max-w-3xl text-muted-foreground text-sm leading-relaxed">
					Run any engine and option against a single URL — the same path as{" "}
					<span className="font-mono">POST /v1/scrape</span>. Every run spends your account's credits.
				</p>
			</header>

			<section className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
				<div className="flex flex-wrap items-start gap-3 px-5 pt-5 pb-4">
					<div className="w-full min-w-[16rem] sm:w-auto sm:flex-1">
						<Field label="URL" htmlFor="pg-url">
							<Input
								id="pg-url"
								type="url"
								className="font-mono text-[0.8125rem]"
								value={form.url}
								onChange={(event) => update("url", event.target.value)}
								placeholder="https://example.com"
							/>
						</Field>
					</div>
					<div className="w-full sm:w-[13rem]">
						<Field label="Engine" htmlFor="pg-engine" hint={ENGINE_HINTS[form.engine]}>
							<Select
								id="pg-engine"
								className="font-mono text-[0.8125rem]"
								options={ENGINE_OPTIONS}
								value={form.engine}
								onChange={(event) => onEngineChange(event.target.value)}
							/>
						</Field>
					</div>
					<div className="flex w-full flex-col gap-1.5 sm:w-auto">
						<span aria-hidden="true" className="invisible hidden font-medium text-sm sm:block">
							Run
						</span>
						<Button className="sm:px-7" onClick={onRun} disabled={running || form.url.length === 0}>
							{running ? (
								<>
									<Spinner />
									Running
								</>
							) : (
								"Run"
							)}
						</Button>
					</div>
				</div>
				<div className="flex flex-wrap items-start gap-x-6 gap-y-4 border-border/70 border-t px-5 pt-3.5 pb-4">
					<div className={cn("w-[9.5rem]", regionApplies ? undefined : "opacity-60")}>
						<Field label="Region" htmlFor="pg-region" hint="Proxy engines only.">
							<Select
								id="pg-region"
								className="font-mono text-[0.8125rem]"
								options={REGION_OPTIONS}
								value={form.region}
								disabled={!regionApplies}
								onChange={(event) => update("region", event.target.value)}
							/>
						</Field>
					</div>
					<div className="w-[9.5rem]">
						<Field label="Extractor" htmlFor="pg-extractor">
							<Select
								id="pg-extractor"
								className="font-mono text-[0.8125rem]"
								options={EXTRACTOR_OPTIONS}
								value={form.extractor}
								onChange={(event) => update("extractor", event.target.value)}
							/>
						</Field>
					</div>
					<div className="flex min-h-10 flex-wrap items-center gap-6 sm:pt-[1.6875rem]">
						<Checkbox
							id="pg-frontmatter"
							label="Frontmatter"
							checked={form.frontmatter}
							onChange={(checked) => update("frontmatter", checked)}
						/>
						<Checkbox
							id="pg-screenshot"
							label="Screenshot"
							hint={screenshotAllowed ? "Capture a PNG of the rendered page." : "Browser engines only."}
							checked={form.screenshot}
							disabled={!screenshotAllowed}
							onChange={(checked) => update("screenshot", checked)}
						/>
						<Checkbox
							id="pg-rehost"
							label="Rehost images"
							checked={form.rehostImages}
							onChange={(checked) => update("rehostImages", checked)}
						/>
						<Checkbox
							id="pg-robots"
							label="Honor robots.txt"
							hint="Check the site's robots.txt first; disallowed pages fail with robots_disallowed."
							checked={form.respectRobotsTxt}
							onChange={(checked) => update("respectRobotsTxt", checked)}
						/>
					</div>
				</div>
				<CurlStrip curl={curl} />
			</section>

			<div className="mt-4 flex flex-col gap-3">
				{run.status === "idle" ? (
					<div className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-5 pt-14 pb-16 text-center">
						<p className="font-medium text-foreground text-sm">No run yet</p>
						<p className="text-[0.8125rem] text-muted-foreground">
							Configure a request and press Run — the markdown result appears here.
						</p>
					</div>
				) : null}
				{run.status === "running" ? <LoadingRow label="Scraping" /> : null}
				{run.status === "error" ? <RunError error={run.error} /> : null}
				{run.status === "done" ? <ResultView result={run.result} /> : null}
			</div>
		</div>
	);
};

export const PlaygroundPage = ({ session }: { session: SessionState }) => {
	const anonymous = session.status === "anonymous";

	useEffect(() => {
		if (anonymous) {
			navigate("/login", { replace: true });
		}
	}, [anonymous]);

	if (session.status === "loading") {
		return (
			<div className="mx-auto w-full max-w-6xl px-5 py-10">
				<LoadingRow label="Checking your session" />
			</div>
		);
	}

	if (session.status === "error") {
		return (
			<div className="mx-auto w-full max-w-2xl px-5 py-16">
				<Alert tone="error" title="Session unavailable">
					{session.error}
				</Alert>
			</div>
		);
	}

	if (session.status === "anonymous") {
		return (
			<div className="mx-auto w-full max-w-2xl px-5 py-16">
				<Alert tone="info" title="Sign in required">
					Redirecting to the sign-in page.
				</Alert>
			</div>
		);
	}

	return <PlaygroundBody />;
};
