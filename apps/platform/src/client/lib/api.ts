import {
	authMethodsSchema,
	billingRedirectSchema,
	deletedSchema,
	demoSchema,
	jobsSchema,
	playgroundSchema,
	usageSchema,
} from "./api-schemas";
import { requestJson } from "./json-request";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

export type SubscriptionStatus = "none" | "active" | "past_due" | "canceled";

export type UsageEvent = {
	id: string;
	/** Set for pages of a batch/crawl job; `null` for single requests. */
	jobId: string | null;
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

export const fetchUsage = (): Promise<Result<UsageSummary>> => requestJson(fetch, "/api/dashboard/usage", usageSchema);

export const fetchJobs = async (): Promise<Result<JobSummary[]>> => {
	const result = await requestJson(fetch, "/api/dashboard/jobs", jobsSchema);
	return result.ok ? ok(result.value.jobs) : result;
};

const billingRedirect = async (path: string): Promise<Result<string>> => {
	const result = await requestJson(fetch, path, billingRedirectSchema, { method: "POST" });
	return result.ok ? ok(result.value.url) : result;
};

export const startCheckout = (): Promise<Result<string>> => billingRedirect("/api/dashboard/billing/checkout");
export const openBillingPortal = (): Promise<Result<string>> => billingRedirect("/api/dashboard/billing/portal");

export type PlaygroundRequest = {
	url: string;
	engine: string;
	screenshot: boolean;
	rehostImages: boolean;
	region: string;
	respectRobotsTxt?: boolean;
	convert: { extractor: string; frontmatter: boolean };
};

export type PlaygroundResult = {
	url: string;
	/** The engine that actually ran — an `auto` request resolves to a concrete one. */
	engine: string;
	markdown: string;
	metadata: Record<string, unknown>;
	credits: number;
	screenshotUrl?: string;
	images?: { original: string; rehosted: string }[];
	/** Present when the result is probably degraded (e.g. an unrendered client-side shell). */
	warning?: string;
};

/**
 * Runs a single sync scrape against the session-authenticated playground endpoint. Unlike the
 * public demo this spends the signed-in account's credits, exactly like `POST /v1/scrape`.
 */
export const runPlaygroundScrape = (request: PlaygroundRequest): Promise<Result<PlaygroundResult>> =>
	requestJson(fetch, "/api/dashboard/playground/scrape", playgroundSchema, {
		method: "POST",
		body: JSON.stringify(request),
	});

export type DemoResult = {
	url: string;
	region: string;
	engine: string;
	markdown: string;
	truncated: boolean;
	title?: string;
	metadata: Record<string, unknown>;
};

/**
 * Runs the public, unauthenticated landing-page demo (`POST /v1/demo/scrape`): fixed `auto`
 * engine (renders client-side pages when needed), rate-limited per IP, truncated output.
 * Nothing is billed. No region: Japan egress needs the proxy engines, which are paid-only.
 */
export const runDemoScrape = (url: string): Promise<Result<DemoResult>> =>
	requestJson(fetch, "/v1/demo/scrape", demoSchema, {
		method: "POST",
		body: JSON.stringify({ url }),
	});

/** Sign-in methods this deployment offers beyond email codes (`GET /api/auth-methods`). */
export type AuthMethods = { github: boolean; password: boolean; turnstileSiteKey: string | null };

export const fetchAuthMethods = (): Promise<Result<AuthMethods>> =>
	requestJson(fetch, "/api/auth-methods", authMethodsSchema);

/** Deletes the signed-in account; `confirmEmail` must equal the account's email. */
export const deleteAccount = (confirmEmail: string): Promise<Result<{ deleted: true }>> =>
	requestJson(fetch, "/api/dashboard/account/delete", deletedSchema, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ confirmEmail }),
	});
