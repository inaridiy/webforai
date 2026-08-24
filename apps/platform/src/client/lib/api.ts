export type Result<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

export type SubscriptionStatus = "none" | "active" | "past_due" | "canceled";

export type UsageEvent = {
	id: string;
	operation: string;
	credits: number;
	createdAt: string;
};

export type UsageSummary = {
	monthCredits: number;
	freeAllowance: number;
	billingEnabled: boolean;
	subscriptionStatus: SubscriptionStatus;
	recentEvents: UsageEvent[];
};

export type JobStatus = "queued" | "running" | "completed" | "failed" | string;

export type JobSummary = {
	id: string;
	type: string;
	status: JobStatus;
	total: number;
	succeeded: number;
	failed: number;
	creditsUsed: number;
	createdAt: string;
};

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string, status: number): Result<T> => ({ ok: false, error, status });

/** `{ error: { code, message } }` is the documented platform error envelope. */
const errorMessageOf = (body: unknown, status: number): string => {
	if (typeof body === "object" && body !== null && "error" in body) {
		const inner = (body as { error: unknown }).error;
		if (typeof inner === "string") {
			return inner;
		}
		if (typeof inner === "object" && inner !== null && "message" in inner) {
			const message = (inner as { message: unknown }).message;
			if (typeof message === "string" && message.length > 0) {
				return message;
			}
		}
	}
	return `Request failed with status ${status}.`;
};

const requestJson = async <T>(path: string, init?: RequestInit): Promise<Result<T>> => {
	let response: Response;
	try {
		response = await fetch(path, {
			credentials: "include",
			headers: {
				accept: "application/json",
				...(init?.body === undefined ? {} : { "content-type": "application/json" }),
			},
			...init,
		});
	} catch {
		return fail("Network error — the platform API could not be reached.", 0);
	}

	const text = await response.text();
	let body: unknown = null;
	if (text.length > 0) {
		try {
			body = JSON.parse(text);
		} catch {
			body = null;
		}
	}

	if (!response.ok) {
		return fail(errorMessageOf(body, response.status), response.status);
	}
	// A 200 carrying HTML (SPA fallback, proxy error page) must not reach the views as data.
	if (typeof body !== "object" || body === null) {
		return fail("The API returned an unexpected response.", response.status);
	}
	return ok(body as T);
};

export const fetchUsage = (): Promise<Result<UsageSummary>> => requestJson<UsageSummary>("/api/dashboard/usage");

/**
 * The jobs endpoint may not exist yet in a given deployment; callers render an empty state for
 * any non-200 rather than surfacing an error banner.
 */
export const fetchJobs = async (): Promise<Result<JobSummary[]>> => {
	const result = await requestJson<{ jobs?: JobSummary[] }>("/api/dashboard/jobs");
	if (!result.ok) {
		return result;
	}
	return ok(result.value.jobs ?? []);
};

const billingRedirect = async (path: string): Promise<Result<string>> => {
	const result = await requestJson<{ url?: string }>(path, { method: "POST" });
	if (!result.ok) {
		if (result.status === 409) {
			return fail("Billing is not configured on this deployment.", 409);
		}
		return result;
	}
	const url = result.value.url;
	if (typeof url !== "string" || url.length === 0) {
		return fail("Billing responded without a redirect URL.", 500);
	}
	return ok(url);
};

export const startCheckout = (): Promise<Result<string>> => billingRedirect("/api/dashboard/billing/checkout");
export const openBillingPortal = (): Promise<Result<string>> => billingRedirect("/api/dashboard/billing/portal");

export type PlaygroundRequest = {
	url: string;
	engine: string;
	screenshot: boolean;
	rehostImages: boolean;
	region: string;
	convert: { extractor: string; frontmatter: boolean };
};

export type PlaygroundResult = {
	url: string;
	engine: string;
	markdown: string;
	metadata: Record<string, unknown>;
	credits: number;
	screenshotUrl?: string;
	images?: { original: string; rehosted: string }[];
};

/**
 * Runs a single sync scrape against the session-authenticated playground endpoint. Unlike the
 * public demo this spends the signed-in account's credits, exactly like `POST /v1/scrape`.
 */
export const runPlaygroundScrape = (request: PlaygroundRequest): Promise<Result<PlaygroundResult>> =>
	requestJson<PlaygroundResult>("/api/dashboard/playground/scrape", {
		method: "POST",
		body: JSON.stringify(request),
	});

export type DemoResult = {
	url: string;
	region: string;
	markdown: string;
	truncated: boolean;
	title?: string;
	metadata: Record<string, unknown>;
};

/**
 * Runs the public, unauthenticated landing-page demo (`POST /v1/demo/scrape`): fixed
 * proxy-fetch engine, rate-limited per IP, truncated output. Nothing is billed.
 */
export const runDemoScrape = (url: string, region: string): Promise<Result<DemoResult>> =>
	requestJson<DemoResult>("/v1/demo/scrape", {
		method: "POST",
		body: JSON.stringify({ url, region }),
	});
