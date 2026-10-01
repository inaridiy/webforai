/**
 * The job-concurrency count against disposable workerd D1 with the checked-in migrations: only
 * this user's queued/running jobs count, and a job whose row has not moved for longer than
 * `STALE_ACTIVE_JOB_MS` (a lost Workflow, a `scheduling_unknown` job) no longer holds capacity.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/db/schema";
import { STALE_ACTIVE_JOB_MS, countActiveJobs } from "../../src/ops/limits";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const runtime = new Miniflare({
	modules: true,
	script: "export default { fetch() { return new Response('ok'); } }",
	d1Databases: ["DB"],
});

const now = new Date("2026-10-01T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

try {
	const binding: D1Database = await runtime.getD1Database("DB");
	const migrationDir = fileURLToPath(new URL("../../drizzle/", import.meta.url));
	for (const file of (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort()) {
		const migration = await readFile(`${migrationDir}/${file}`, "utf8");
		for (const statement of migration.split("--> statement-breakpoint").filter((value) => value.trim())) {
			await binding.prepare(statement).run();
		}
	}
	const db = drizzle(binding, { schema });

	const job = (id: string, userId: string, status: "queued" | "running" | "completed" | "failed", updatedAt: Date) => ({
		id,
		userId,
		type: "batch" as const,
		status,
		request: {},
		createdAt: ago(STALE_ACTIVE_JOB_MS * 3),
		updatedAt,
	});

	await db
		.insert(schema.jobs)
		.values([
			job("fresh-queued", "u1", "queued", ago(60_000)),
			job("fresh-running", "u1", "running", ago(STALE_ACTIVE_JOB_MS - 60_000)),
			job("stale-running", "u1", "running", ago(STALE_ACTIVE_JOB_MS + 60_000)),
			job("stale-queued", "u1", "queued", ago(STALE_ACTIVE_JOB_MS * 2)),
			job("done", "u1", "completed", ago(1_000)),
			job("failed", "u1", "failed", ago(1_000)),
			job("other-user", "u2", "running", ago(1_000)),
		]);

	assert.equal(await countActiveJobs(db, "u1", now), 2);
	assert.equal(await countActiveJobs(db, "u2", now), 1);
	assert.equal(await countActiveJobs(db, "nobody", now), 0);

	console.log("Job capacity passed: queued/running counted per user, finished and stale (>1h silent) jobs ignored.");
} finally {
	await runtime.dispose();
}
