import { Hono } from "hono";

import { type AuthVariables, requireSession } from "../auth/middleware";
import { ensureSpendable, usesProxyTier } from "../billing/guard";
import type { ScrapeRequest } from "../core/types";
import { loadConfig } from "../env";
import { onPlatformError } from "./errors";
import { type PlaygroundBody, playgroundBodySchema } from "./schemas";
import { parseScrapeBody } from "./scrape-body";
import { billingDeps, runSyncScrape } from "./scrape-run";

/**
 * Session-authenticated scrape playground (mounted under `/api/dashboard`).
 *
 * Unlike the public keyless demo (`/v1/demo/scrape`, proxy-fetch only, never billed), this
 * exercises every engine/option and **is billed to the signed-in user's credits**, exactly like
 * `/v1/scrape`. Identity comes from the session user only — never from the request body — so a
 * client cannot spend or attribute usage to another account.
 *
 * `requireSession` is applied here too, so a mounting mistake cannot expose it anonymously.
 */
export const playgroundRoutes = () => {
	const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
	app.onError(onPlatformError);

	app.use("*", requireSession);

	app.post("/playground/scrape", async (c) => {
		const body: PlaygroundBody = await parseScrapeBody(c.req.json(), playgroundBodySchema);
		// biome-ignore lint/style/noNonNullAssertion: requireSession guarantees a user
		const sessionUser = c.get("user")!;
		const config = loadConfig(c.env);

		// Guard first — a failed or unaffordable scrape must never be billed.
		await ensureSpendable(billingDeps(c.env, config), sessionUser.id, { proxy: usesProxyTier(body) });

		const request: ScrapeRequest = {
			url: body.url,
			engine: body.engine,
			screenshot: body.screenshot,
			rehostImages: body.rehostImages,
			region: body.region,
			respectRobotsTxt: body.respectRobotsTxt,
			convert: body.convert,
		};
		const result = await runSyncScrape(c, config, { userId: sessionUser.id, request });

		return c.json(result);
	});

	return app;
};
