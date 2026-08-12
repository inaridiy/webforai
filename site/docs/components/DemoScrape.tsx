import { useState } from "react";
import { PLATFORM_DEMO_ENDPOINT, PLATFORM_REGIONS, type PlatformRegion } from "./platform";

type DemoSuccess = {
	url: string;
	region: PlatformRegion;
	markdown: string;
	truncated: boolean;
	metadata?: { title?: string; description?: string } | null;
};

type DemoError = {
	error?: { code?: string; message?: string; retryAfter?: number };
};

const DEFAULT_URL = "https://example.com";

const REGION_LABELS: Record<PlatformRegion, string> = {
	auto: "auto (nearest)",
	us: "United States",
	eu: "Europe",
	uk: "United Kingdom",
	jp: "Japan",
	asia: "Asia",
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

const readRetryAfter = (response: Response, body: DemoError): number | undefined => {
	const fromBody = body.error?.retryAfter;
	if (typeof fromBody === "number") {
		return fromBody;
	}
	const header = Number(response.headers.get("Retry-After"));
	return Number.isFinite(header) ? header : undefined;
};

const messageFromResponse = (response: Response, body: DemoError): string => {
	if (response.status === 429) {
		const retry = formatRetryAfter(readRetryAfter(response, body));
		return `Rate limited — this public demo allows 5 requests per 10 minutes per IP. Please try again ${retry}.`;
	}
	return body.error?.message ?? `Request failed with status ${response.status}.`;
};

const fieldClassName =
	"rounded-lg border border-black/10 bg-white/60 px-3 py-2 text-[15px] outline-none transition-colors placeholder:opacity-50 focus:border-black/30 dark:border-white/20 dark:bg-black/40 dark:focus:border-white/40";

export const DemoScrape = () => {
	const [url, setUrl] = useState(DEFAULT_URL);
	const [region, setRegion] = useState<PlatformRegion>("auto");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<DemoSuccess | null>(null);

	const convert = async () => {
		const trimmed = url.trim();
		if (!trimmed) {
			setError("Enter a URL to convert.");
			return;
		}

		setIsLoading(true);
		setError(null);
		setResult(null);

		try {
			const response = await fetch(PLATFORM_DEMO_ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ url: trimmed, region }),
			});
			const body = (await response.json().catch(() => ({}))) as DemoError & Partial<DemoSuccess>;

			if (!response.ok) {
				setError(messageFromResponse(response, body));
				return;
			}
			setResult({
				url: body.url ?? trimmed,
				region: body.region ?? region,
				markdown: body.markdown ?? "",
				truncated: body.truncated ?? false,
				metadata: body.metadata ?? null,
			});
		} catch {
			setError("Could not reach the demo API. Check your connection and try again.");
		} finally {
			setIsLoading(false);
		}
	};

	const handleConvert = () => {
		convert().catch(() => setError("Something went wrong. Please try again."));
	};

	const title = result?.metadata?.title;

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<label className="sr-only" htmlFor="demo-url">
					URL to convert
				</label>
				<input
					className={`${fieldClassName} w-full min-w-[240px] flex-1`}
					disabled={isLoading}
					id="demo-url"
					onChange={(event) => setUrl(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !isLoading) {
							handleConvert();
						}
					}}
					placeholder={DEFAULT_URL}
					type="url"
					value={url}
				/>
				<label className="sr-only" htmlFor="demo-region">
					Region
				</label>
				<select
					className={fieldClassName}
					disabled={isLoading}
					id="demo-region"
					onChange={(event) => setRegion(event.target.value as PlatformRegion)}
					value={region}
				>
					{PLATFORM_REGIONS.map((value) => (
						<option key={value} value={value}>
							{REGION_LABELS[value]}
						</option>
					))}
				</select>
				<button
					className="rounded-lg border border-black/10 bg-black/5 px-4 py-2 text-[15px] font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-white/10"
					disabled={isLoading}
					onClick={handleConvert}
					type="button"
				>
					{isLoading ? "Converting…" : "Convert"}
				</button>
			</div>

			{error ? (
				<div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[14px] text-red-700 dark:text-red-300">
					{error}
				</div>
			) : null}

			{result ? (
				<div className="space-y-2">
					{title ? <div className="text-[15px] font-medium">{title}</div> : null}
					<pre className="max-h-[360px] overflow-auto rounded-lg border border-black/10 bg-black/5 p-3 text-[13px] leading-relaxed dark:border-white/20 dark:bg-white/5">
						<code>{result.markdown || "(empty result)"}</code>
					</pre>
					{result.truncated ? (
						<div className="text-[13px] opacity-60">Output truncated by the demo endpoint.</div>
					) : null}
				</div>
			) : null}

			<div className="text-[13px] opacity-60">
				Rate-limited public demo (5 requests / 10 min per IP) running the Webshare <code>proxy-fetch</code> engine. No
				API key required.
			</div>
		</div>
	);
};
