import { WorkerEntrypoint } from "cloudflare:workers";
import { type Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";

import { createArtifactStore } from "./artifacts/store";
import { type Auth, createAuth } from "./auth/auth";
import { type AuthVariables, requireApiKey, sessionMiddleware } from "./auth/middleware";
import { createBillingRepo } from "./billing/repo";
import { createStripe } from "./billing/stripe";
import { retryUnreportedUsage } from "./billing/usage";
import { scrapePage } from "./core/scrape-core";
import { createDb } from "./db/client";
import { createEngines } from "./engines";
import { loadConfig } from "./env";
import { CrawlWorkflow } from "./jobs/workflow";
import { alertCronFailure, alertProxyBandwidth, alertUsageBacklog, opsAlertDeps } from "./ops/alert";
import { refreshProxyBandwidth } from "./proxy/bandwidth";
import { artifactRoutes } from "./routes/artifacts";
import { dashboardRoutes } from "./routes/dashboard";
import { dashboardJobsRoutes } from "./routes/dashboard-jobs";
import { DEMO_CACHE_TTL_SECONDS, type DemoCache, type DemoDeps, type DemoResponse, demoRoutes } from "./routes/demo";
import { onPlatformError } from "./routes/errors";
import { permalinkRoutes } from "./routes/permalink";
import { playgroundRoutes } from "./routes/playground";
import { requestBodyLimit, requireSameOrigin, securityHeaders } from "./routes/security";
import { v1Routes } from "./routes/v1";
import { type ConvertOptions, type ConvertResult, rpcConvert } from "./rpc/convert";

/**
 * Composition root.
 *
 * Config and the Better Auth instance are built **per request**: both depend on bindings that
 * only exist inside an invocation, so a module-scope singleton would capture a dead handle.
 * A malformed configuration therefore surfaces as a 500 from `onError`, never as a Worker that
 * boots and serves half-configured routes.
 *
 * The dashboard SPA is served by Workers Assets; only the routes mounted here reach this code.
 */

type AppEnv = { Bindings: Env; Variables: AuthVariables };

const app = new Hono<AppEnv>();

app.onError(onPlatformError);

// Hardening runs before every route (registration order is dispatch order): baseline security
// headers on all Worker responses, and a body cap on everything that accepts one.
app.use("*", securityHeaders);
app.use("/api/*", requestBodyLimit);
app.use("/v1/*", requestBodyLimit);

app.get("/health", (c) => c.json({ ok: true }));

/**
 * Which sign-in methods this deployment offers, for the sign-in page. Email codes are always
 * on; GitHub only with OAuth credentials; passwords only in local/e2e runs.
 */
app.get("/api/auth-methods", (c) => {
	const config = loadConfig(c.env);
	return c.json({
		github: config.githubLoginEnabled,
		password: config.passwordLoginEnabled,
		turnstileSiteKey: config.TURNSTILE_SITE_KEY && config.TURNSTILE_SECRET_KEY ? config.TURNSTILE_SITE_KEY : null,
	});
});

/** Signed artifact URLs are unauthenticated by design — the token is the credential. */
app.route("/", artifactRoutes());

const authOf = (env: Env): Auth => createAuth(env, loadConfig(env));

/** Hono's `executionCtx` getter throws outside a Workers invocation (unit tests). */
const executionContextOf = (c: Context<AppEnv>): Context<AppEnv>["executionCtx"] | undefined => {
	try {
		return c.executionCtx;
	} catch {
		return undefined;
	}
};

// Better Auth owns sign-in, sign-out, API-key CRUD and the Stripe webhook under this prefix.
app.on(["GET", "POST"], "/api/auth/*", (c) => authOf(c.env).handler(c.req.raw));

// Same-origin SPA: the dashboard is served from this Worker's own assets, so no CORS layer is
// needed. Cross-origin dashboards would need one added here, not in the sub-apps.
// Cookie-authenticated, so state-changing requests must also prove they come from that origin.
app.use(
	"/api/dashboard/*",
	requireSameOrigin((c) => new URL(loadConfig(c.env as Env).BASE_URL).origin),
);
app.use(
	"/api/dashboard/*",
	createMiddleware<AppEnv>((c, next) => sessionMiddleware(authOf(c.env))(c, next)),
);
app.route("/api/dashboard", dashboardRoutes());
app.route("/api/dashboard", dashboardJobsRoutes());
app.route("/api/dashboard", playgroundRoutes());

/**
 * Real dependencies for the public demo. Built here rather than in `routes/demo.ts` so that
 * module stays free of the Workers-only engine imports and can be unit-tested.
 */
/**
 * The Workers default cache. The single tsconfig also serves the SPA and includes the DOM lib,
 * whose `CacheStorage` has no Workers-only `default`.
 */
const workersCache = (): Cache => (caches as unknown as { default: Cache }).default;

/** The demo cache on the Workers Cache API: per data center, expiring by `Cache-Control`. */
const demoCache: DemoCache = {
	get: async (key) => {
		const hit = await workersCache().match(key);
		return hit ? ((await hit.json()) as DemoResponse) : undefined;
	},
	put: (key, value) =>
		workersCache().put(
			key,
			new Response(JSON.stringify(value), {
				headers: { "content-type": "application/json", "cache-control": `max-age=${DEMO_CACHE_TTL_SECONDS}` },
			}),
		),
};

const demoDeps = (env: Env): DemoDeps => {
	const config = loadConfig(env);
	const scrape = { engines: createEngines(env, config), artifacts: createArtifactStore(env, config) };
	return {
		kv: env.JOBS_KV,
		burstLimiter: env.DEMO_RATE_LIMIT,
		cache: demoCache,
		runScrape: (request) => scrapePage(scrape, request),
		now: () => new Date(),
	};
};

/**
 * Registered **before** the `/v1/*` API-key middleware, and that order is the guarantee: Hono
 * dispatches matched handlers in registration order and stops at the first one that returns a
 * response, so `POST /v1/demo/scrape` answers without `requireApiKey` ever running. Moving this
 * line below the `app.use` would silently make the demo require a key.
 */
app.route("/v1/demo", demoRoutes(demoDeps));

app.use(
	"/v1/*",
	createMiddleware<AppEnv>((c, next) => requireApiKey(authOf(c.env))(c, next)),
);
app.route("/v1", v1Routes());

/**
 * `GET /https://…` → text/markdown. Re-dispatched through this same router, so the key path
 * gets API-key auth, limits and billing and the keyless path gets the demo's limits; registered
 * last because its catch-all only claims paths that start with a URL scheme.
 */
app.route(
	"/",
	permalinkRoutes<AppEnv>(async (request, c) => app.fetch(request, c.env, executionContextOf(c))),
);

/**
 * Reconciliation for meter events Stripe never acknowledged. Cron-driven (see wrangler.jsonc):
 * the ledger row is written first and stays unreported until this pass lands it, so a Stripe
 * outage delays billing instead of losing it.
 */
const runScheduledPass = async (env: Env): Promise<void> => {
	const config = loadConfig(env);
	const alerts = opsAlertDeps(env);
	// Independent jobs: a proxy-account outage must not hold back billing, nor the reverse.
	const results = await Promise.allSettled([
		retryUnreportedUsage(
			{
				repo: createBillingRepo(createDb(env)),
				config,
				stripe: createStripe(config),
				onBacklog: (backlog) => alertUsageBacklog(alerts, backlog),
			},
			RETRY_USAGE_PAGE_SIZE,
			RETRY_USAGE_MAX_PAGES,
		),
		config.proxyBandwidthGuard && config.PROXY_ACCOUNT_API_URL && config.PROXY_ACCOUNT_API_KEY
			? refreshProxyBandwidth({
					kv: env.JOBS_KV,
					api: {
						baseUrl: config.PROXY_ACCOUNT_API_URL,
						apiKey: config.PROXY_ACCOUNT_API_KEY,
						fetch: (input, init) => fetch(input, init),
					},
					now: () => new Date(),
					log: console,
					onThreshold: (threshold, snapshot, ratio) => alertProxyBandwidth(alerts, { ...snapshot, threshold, ratio }),
				})
			: Promise.resolve(undefined),
	]);
	const failure = results.find((result) => result.status === "rejected");
	if (failure) {
		throw failure.reason;
	}
};

/** A failed pass emails the operator (`OPS_ALERT_EMAIL`, at most hourly) and still fails the run. */
const scheduled: ExportedHandlerScheduledHandler<Env> = async (_controller, env) => {
	try {
		await runScheduledPass(env);
	} catch (error) {
		await alertCronFailure(opsAlertDeps(env), error);
		throw error;
	}
};

const RETRY_USAGE_PAGE_SIZE = 100;
/** Each row costs a Stripe call and a D1 write; 4 pages stays well inside one invocation's D1 query limit. */
const RETRY_USAGE_MAX_PAGES = 4;

/**
 * Internal conversion service for other Workers on this account, via a Service Binding:
 * `services: [{ binding: "WEBFORAI", service: "webforai-platform", entrypoint: "PlatformRpc" }]`.
 * No API key or billing — the binding is the credential; see `src/rpc/convert.ts` for what is
 * bypassed and what is kept (SSRF guard, Browser Run, the per-tenant `RATE_LIMIT_INTERNAL`).
 */
export class PlatformRpc extends WorkerEntrypoint<Env> {
	async convert(url: string, options: ConvertOptions): Promise<ConvertResult> {
		const config = loadConfig(this.env);
		return rpcConvert(
			{
				scrape: { engines: createEngines(this.env, config), artifacts: createArtifactStore(this.env, config) },
				limiter: this.env.RATE_LIMIT_INTERNAL,
			},
			url,
			options,
		);
	}
}

// biome-ignore lint/style/noDefaultExport: Workers entrypoint
export default { fetch: app.fetch, scheduled };
export { NodejsFnContainer } from "./__generated__/create-nodejs-fn.do";
export { CrawlWorkflow };
