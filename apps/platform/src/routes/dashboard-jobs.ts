import { Hono } from "hono";
import { type AuthVariables, requireSession } from "../auth/middleware";
import { createDb } from "../db/client";
import { DEFAULT_JOB_LIST_LIMIT, createJobsRepo } from "../jobs/repo";

/**
 * Job list for the dashboard SPA (session cookie, not an API key).
 *
 * Mounted under `/api/dashboard` next to `dashboardRoutes`; `requireSession` is applied here
 * too, so a mounting mistake cannot expose another account's jobs.
 */
export const dashboardJobsRoutes = () => {
	const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

	app.use("*", requireSession);

	app.get("/jobs", async (c) => {
		// biome-ignore lint/style/noNonNullAssertion: requireSession guarantees a user
		const sessionUser = c.get("user")!;
		const rows = await createJobsRepo(createDb(c.env)).listJobsByUser(sessionUser.id, DEFAULT_JOB_LIST_LIMIT);

		return c.json({
			jobs: rows.map((row) => ({
				id: row.id,
				type: row.type,
				status: row.status,
				total: row.total,
				succeeded: row.succeeded,
				failed: row.failed,
				creditsUsed: row.creditsUsed,
				createdAt: row.createdAt.toISOString(),
			})),
		});
	});

	return app;
};
