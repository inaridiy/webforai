import { type Context, Hono, type Env as HonoEnv } from "hono";

import { MAX_URL_LENGTH } from "./schemas";

/**
 * Markdown permalinks: `GET /https://example.com/page` answers with the page as `text/markdown`.
 *
 * Not a second scrape implementation — the request is re-dispatched through the Worker's own
 * router, so every existing rule applies unchanged:
 * - with `Authorization: Bearer wfa_…` it becomes `POST /v1/scrape` (`auto` engine): API-key
 *   auth, tier rate limit, spend guard and billing exactly as for the JSON API;
 * - without a key it becomes `POST /v1/demo/scrape`: the demo's limits, cache and truncation.
 *
 * Everything after the first `/` is the target, query string included, so the target's own
 * query cannot carry options. A client or proxy that collapses `//` into `/` (`/https:/x.com`)
 * still works.
 */

const PERMALINK_PATH = /^\/(https?):\/*/i;

/** The target URL a permalink path names, or undefined when the path is not a permalink. */
export const permalinkTarget = (requestUrl: string): string | undefined => {
	const url = new URL(requestUrl);
	const match = PERMALINK_PATH.exec(url.pathname);
	if (!match) {
		return undefined;
	}
	const rest = url.pathname.slice(match[0].length);
	return `${(match[1] ?? "").toLowerCase()}://${rest}${url.search}`;
};

interface ScrapeJson {
	markdown?: unknown;
	engine?: unknown;
	truncated?: unknown;
	credits?: unknown;
}

interface ErrorJson {
	error?: { code?: unknown; message?: unknown };
}

const text = (body: string, status: number, headers: Record<string, string> = {}): Response =>
	new Response(body, {
		status,
		headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*", ...headers },
	});

/** An upstream JSON error envelope as a one-line plain-text body; `Retry-After` survives. */
const toTextError = async (response: Response): Promise<Response> => {
	const body = (await response.json().catch(() => ({}))) as ErrorJson;
	const code = typeof body.error?.code === "string" ? body.error.code : "error";
	const message = typeof body.error?.message === "string" ? body.error.message : response.statusText;
	const retryAfter = response.headers.get("retry-after");
	return text(`${code}: ${message}\n`, response.status, retryAfter ? { "retry-after": retryAfter } : {});
};

/** The incoming headers the re-dispatched request keeps: credentials and the client's identity. */
const forwardedHeaders = (header: (name: string) => string | undefined): Headers => {
	const headers = new Headers({ "content-type": "application/json" });
	for (const name of ["authorization", "cf-connecting-ip", "user-agent"]) {
		const value = header(name);
		if (value) {
			headers.set(name, value);
		}
	}
	return headers;
};

const markdownHeaders = (result: ScrapeJson, target: string, keyed: boolean): Record<string, string> => {
	const out: Record<string, string> = {
		"content-type": "text/markdown; charset=utf-8",
		"access-control-allow-origin": "*",
		"x-content-type-options": "nosniff",
		// Keyed results are billed per request and private to the caller; demo results are
		// already cached server-side for the same 10 minutes.
		"cache-control": keyed ? "private, no-store" : "public, max-age=600",
		vary: "authorization",
		"x-webforai-source": target,
	};
	if (typeof result.engine === "string") {
		out["x-webforai-engine"] = result.engine;
	}
	if (typeof result.truncated === "boolean") {
		out["x-webforai-truncated"] = String(result.truncated);
	}
	if (typeof result.credits === "number") {
		out["x-webforai-credits"] = String(result.credits);
	}
	return out;
};

/** Runs the rewritten request through the Worker's router, with the incoming request's context. */
export type PermalinkDispatch<E extends HonoEnv> = (request: Request, c: Context<E>) => Promise<Response>;

export const permalinkRoutes = <E extends HonoEnv>(dispatch: PermalinkDispatch<E>) => {
	const app = new Hono<E>();

	app.get("*", async (c, next) => {
		const target = permalinkTarget(c.req.url);
		if (target === undefined) {
			return next();
		}
		// Hono routes HEAD to GET handlers; a HEAD must not run (and bill) a scrape.
		if (c.req.method !== "GET") {
			return text("", 405, { allow: "GET" });
		}
		if (target.length > MAX_URL_LENGTH) {
			return text(`invalid_request: the URL is longer than ${MAX_URL_LENGTH} characters.\n`, 400);
		}

		const authorization = c.req.header("authorization");
		const origin = new URL(c.req.url).origin;
		const path = authorization ? "/v1/scrape" : "/v1/demo/scrape";
		const response = await dispatch(
			new Request(`${origin}${path}`, {
				method: "POST",
				headers: forwardedHeaders((name) => c.req.header(name)),
				body: JSON.stringify({ url: target }),
			}),
			c,
		);
		if (!response.ok) {
			return toTextError(response);
		}

		const result = (await response.json()) as ScrapeJson;
		const out = markdownHeaders(result, target, authorization !== undefined);
		return new Response(typeof result.markdown === "string" ? result.markdown : "", { status: 200, headers: out });
	});

	return app;
};
