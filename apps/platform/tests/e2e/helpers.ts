import { BASE_URL } from "./config";

/**
 * HTTP helpers for the E2E specs.
 *
 * Everything here talks to the *real* running Worker over the network — there are no mocks. The
 * helpers only remove boilerplate: JSON bodies, the `Origin` header Better Auth requires, a tiny
 * cookie jar, and a job poller.
 */

export interface JsonResponse<T = unknown> {
	status: number;
	headers: Headers;
	body: T;
	raw: string;
}

const asJson = <T>(raw: string): T => {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return raw as unknown as T;
	}
};

export const api = async <T = unknown>(
	path: string,
	init: RequestInit & { json?: unknown } = {},
): Promise<JsonResponse<T>> => {
	const { json, headers, ...rest } = init;
	const finalHeaders = new Headers(headers);
	let body = rest.body;
	if (json !== undefined) {
		finalHeaders.set("content-type", "application/json");
		body = JSON.stringify(json);
	}
	const res = await fetch(`${BASE_URL}${path}`, { ...rest, headers: finalHeaders, body });
	const raw = await res.text();
	return { status: res.status, headers: res.headers, body: asJson<T>(raw), raw };
};

/** Better Auth requires an `Origin` matching `baseURL`; every auth call sends it. */
const authHeaders = (extra?: HeadersInit): Headers => {
	const h = new Headers(extra);
	h.set("Origin", BASE_URL);
	return h;
};

/** Reruns persist the local D1, so every account uses a fresh, unique email. */
export const uniqueEmail = (label = "e2e"): string =>
	`${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

export interface Account {
	email: string;
	userId: string;
	/** Cookie header value for session-authenticated requests (dashboard). */
	cookie: string;
}

/** Signs a brand-new account up and returns its session cookie. */
export const signUp = async (email = uniqueEmail()): Promise<Account> => {
	const res = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
		method: "POST",
		headers: authHeaders({ "content-type": "application/json" }),
		body: JSON.stringify({ email, password: "Passw0rd!e2e", name: "E2E User" }),
	});
	const raw = await res.text();
	if (res.status !== 200) {
		throw new Error(`sign-up failed (${res.status}): ${raw}`);
	}
	const parsed = JSON.parse(raw) as { user: { id: string } };
	const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
	if (!cookie) {
		throw new Error(`sign-up returned no session cookie: ${raw}`);
	}
	return { email, userId: parsed.user.id, cookie };
};

/** Mints an API key for the given session and returns the `wfa_...` secret. */
export const createApiKey = async (account: Account, name = "e2e-key"): Promise<string> => {
	const res = await fetch(`${BASE_URL}/api/auth/api-key/create`, {
		method: "POST",
		headers: authHeaders({ "content-type": "application/json", cookie: account.cookie }),
		body: JSON.stringify({ name }),
	});
	const raw = await res.text();
	if (res.status !== 200) {
		throw new Error(`api-key create failed (${res.status}): ${raw}`);
	}
	const parsed = JSON.parse(raw) as { key?: string };
	if (!parsed.key?.startsWith("wfa_")) {
		throw new Error(`api-key create returned no wfa_ key: ${raw}`);
	}
	return parsed.key;
};

export const bearer = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}` });

export interface JobStatus {
	jobId: string;
	type: string;
	status: "queued" | "running" | "completed" | "failed" | string;
	total: number;
	completed: number;
	failed: number;
	credits: number;
}

const TERMINAL = new Set(["completed", "failed"]);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Polls `GET /v1/jobs/:id` until it reaches a terminal status or the timeout elapses. */
export const pollJob = async (jobId: string, key: string, timeoutMs = 60_000): Promise<JobStatus> => {
	const deadline = Date.now() + timeoutMs;
	let last: JobStatus | undefined;
	while (Date.now() < deadline) {
		const res = await api<JobStatus>(`/v1/jobs/${jobId}`, { headers: bearer(key) });
		if (res.status !== 200) {
			throw new Error(`job poll failed (${res.status}): ${res.raw}`);
		}
		last = res.body;
		if (TERMINAL.has(last.status)) {
			return last;
		}
		await sleep(500);
	}
	throw new Error(`job ${jobId} did not finish within ${timeoutMs}ms (last: ${JSON.stringify(last)})`);
};
