import { Hono } from "hono";
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
import { artifactRoutes } from "./routes/artifacts";
import { dashboardRoutes } from "./routes/dashboard";
import { dashboardJobsRoutes } from "./routes/dashboard-jobs";
import { DEMO_CACHE_TTL_SECONDS, type DemoCache, type DemoDeps, type DemoResponse, demoRoutes } from "./routes/demo";
import { onPlatformError } from "./routes/errors";
import { playgroundRoutes } from "./routes/playground";
import { v1Routes } from "./routes/v1";

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

app.get("/health", (c) => c.json({ ok: true }));

/** Signed artifact URLs are unauthenticated by design — the token is the credential. */
app.route("/", artifactRoutes());

const authOf = (env: Env): Auth => createAuth(env, loadConfig(env));

// Better Auth owns sign-in, sign-out, API-key CRUD and the Stripe webhook under this prefix.
app.on(["GET", "POST"], "/api/auth/*", (c) => authOf(c.env).handler(c.req.raw));

// Same-origin SPA: the dashboard is served from this Worker's own assets, so no CORS layer is
// needed. Cross-origin dashboards would need one added here, not in the sub-apps.
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
		cache: demoCache,
		proxyEnabled: config.proxyEnabled,
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
 * Reconciliation for meter events Stripe never acknowledged. Cron-driven (see wrangler.jsonc):
 * the ledger row is written first and stays unreported until this pass lands it, so a Stripe
 * outage delays billing instead of losing it.
 */
const scheduled: ExportedHandlerScheduledHandler<Env> = async (_controller, env) => {
	const config = loadConfig(env);
	await retryUnreportedUsage(
		{ repo: createBillingRepo(createDb(env)), config, stripe: createStripe(config) },
		RETRY_USAGE_LIMIT,
	);
};

const RETRY_USAGE_LIMIT = 100;

// biome-ignore lint/style/noDefaultExport: Workers entrypoint
export default { fetch: app.fetch, scheduled };
export { NodejsFnContainer } from "./__generated__/create-nodejs-fn.do";
export { CrawlWorkflow };
