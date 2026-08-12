import { useEffect, useMemo, useState } from "react";
import { type PlaygroundRequest, type PlaygroundResult, type Result, runPlaygroundScrape } from "../lib/api";
import { Link, navigate } from "../lib/router";
import type { SessionState } from "../lib/use-session";
import { Alert } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { CodeBlock } from "../ui/code-block";
import { Field, Input, Label } from "../ui/input";
import { Select, type SelectOption } from "../ui/select";
import { LoadingRow, Spinner } from "../ui/spinner";

const ENGINE_OPTIONS: SelectOption[] = [
	{ value: "fetch", label: "fetch — Cloudflare egress, fastest" },
	{ value: "proxy-fetch", label: "proxy-fetch — Webshare egress, geo-targetable" },
	{ value: "proxy-browser", label: "proxy-browser — headless browser via proxy" },
	{ value: "cf-browser", label: "cf-browser — Cloudflare Browser Rendering" },
];

const REGION_OPTIONS: SelectOption[] = [
	{ value: "auto", label: "auto (no geo-targeting)" },
	{ value: "us", label: "us" },
	{ value: "eu", label: "eu" },
	{ value: "uk", label: "uk" },
	{ value: "jp", label: "jp" },
	{ value: "asia", label: "asia" },
];

const EXTRACTOR_OPTIONS: SelectOption[] = [
	{ value: "auto", label: "auto" },
	{ value: "takumi", label: "takumi" },
	{ value: "minimal", label: "minimal" },
	{ value: "none", label: "none (raw conversion)" },
];

const SCREENSHOT_ENGINES = new Set(["proxy-browser", "cf-browser"]);

type FormState = {
	url: string;
	engine: string;
	region: string;
	extractor: string;
	frontmatter: boolean;
	screenshot: boolean;
	rehostImages: boolean;
};

const INITIAL_FORM: FormState = {
	url: "https://example.com",
	engine: "fetch",
	region: "auto",
	extractor: "auto",
	frontmatter: true,
	screenshot: false,
	rehostImages: false,
};

const buildRequest = (form: FormState): PlaygroundRequest => ({
	url: form.url,
	engine: form.engine,
	screenshot: form.screenshot,
	rehostImages: form.rehostImages,
	region: form.region,
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
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<Badge tone="success">
					{result.credits} credit{result.credits === 1 ? "" : "s"} used
				</Badge>
				<Badge tone="neutral">{result.engine}</Badge>
				{title === undefined ? null : <span className="font-medium text-foreground text-sm">{title}</span>}
			</div>
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
			<Card>
				<CardHeader>
					<CardTitle>Markdown</CardTitle>
				</CardHeader>
				<CardContent>
					<pre className="max-h-[32rem] overflow-auto rounded-md border border-border bg-muted/40 p-4 font-mono text-[0.8125rem] text-foreground leading-relaxed">
						{result.markdown}
					</pre>
				</CardContent>
			</Card>
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

const PlaygroundBody = () => {
	const [form, setForm] = useState<FormState>(INITIAL_FORM);
	const [run, setRun] = useState<RunState>({ status: "idle" });

	const screenshotAllowed = SCREENSHOT_ENGINES.has(form.engine);

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
			<header className="mb-8">
				<p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider">Playground</p>
				<h1 className="mt-1 font-semibold text-2xl tracking-tight">Scrape playground</h1>
				<p className="mt-2 max-w-3xl text-muted-foreground text-sm leading-relaxed">
					Run any engine and option against a single URL, billed to your account's credits — the same path as{" "}
					<span className="font-mono">POST /v1/scrape</span>. This is not the public demo: every run spends your own
					credits.
				</p>
			</header>

			<div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
				<div className="flex flex-col gap-4">
					<Card>
						<CardHeader>
							<CardTitle>Request</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<Field label="URL" htmlFor="pg-url">
								<Input
									id="pg-url"
									type="url"
									value={form.url}
									onChange={(event) => update("url", event.target.value)}
									placeholder="https://example.com"
								/>
							</Field>
							<Field label="Engine" htmlFor="pg-engine">
								<Select
									id="pg-engine"
									options={ENGINE_OPTIONS}
									value={form.engine}
									onChange={(event) => onEngineChange(event.target.value)}
								/>
							</Field>
							<Field label="Region" htmlFor="pg-region" hint="Honoured by the proxy engines only; ignored elsewhere.">
								<Select
									id="pg-region"
									options={REGION_OPTIONS}
									value={form.region}
									onChange={(event) => update("region", event.target.value)}
								/>
							</Field>
							<Field label="Extractor" htmlFor="pg-extractor">
								<Select
									id="pg-extractor"
									options={EXTRACTOR_OPTIONS}
									value={form.extractor}
									onChange={(event) => update("extractor", event.target.value)}
								/>
							</Field>
							<div className="flex flex-col gap-3 pt-1">
								<Label>Options</Label>
								<Checkbox
									id="pg-frontmatter"
									label="Frontmatter"
									hint="Prepend YAML metadata to the markdown."
									checked={form.frontmatter}
									onChange={(checked) => update("frontmatter", checked)}
								/>
								<Checkbox
									id="pg-screenshot"
									label="Screenshot"
									hint={screenshotAllowed ? "Capture a PNG of the rendered page." : "Only proxy-browser or cf-browser."}
									checked={form.screenshot}
									disabled={!screenshotAllowed}
									onChange={(checked) => update("screenshot", checked)}
								/>
								<Checkbox
									id="pg-rehost"
									label="Rehost images"
									hint="Copy referenced images to your artifact store."
									checked={form.rehostImages}
									onChange={(checked) => update("rehostImages", checked)}
								/>
							</div>
							<Button onClick={onRun} disabled={running || form.url.length === 0}>
								{running ? (
									<>
										<Spinner />
										Running
									</>
								) : (
									"Run"
								)}
							</Button>
						</CardContent>
					</Card>
					<CodeBlock label="Equivalent API request" code={curl} />
				</div>

				<div className="flex flex-col gap-4">
					{run.status === "idle" ? (
						<Alert tone="info" title="No run yet">
							Configure a request and press Run. Results appear here.
						</Alert>
					) : null}
					{run.status === "running" ? <LoadingRow label="Scraping" /> : null}
					{run.status === "error" ? <RunError error={run.error} /> : null}
					{run.status === "done" ? <ResultView result={run.result} /> : null}
				</div>
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
