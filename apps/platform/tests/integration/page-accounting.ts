/** Runs production Drizzle repositories against disposable workerd D1, never the dev DB. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/db/schema";
import { type PageCommit, createPageAccountingRepo, pageCommitId } from "../../src/jobs/page-accounting";
import { createJobsRepo } from "../../src/jobs/repo";

// Wrangler owns this Miniflare version; exercise its actual bundled D1 runtime.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const runtime = new Miniflare({
	modules: true,
	script: "export default { fetch() { return new Response('ok'); } }",
	d1Databases: ["DB"],
});
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
	const jobs = createJobsRepo(db);
	const pages = createPageAccountingRepo(db);
	await jobs.createJob({ id: "crawl-test", userId: "owner", type: "crawl", request: {} });
	await jobs.updateStatus("crawl-test", "running");
	await jobs.updateStatus("crawl-test", "queued", { error: "scheduling_unknown" });
	assert.equal((await jobs.getJob("crawl-test", "owner"))?.status, "running");
	assert.equal((await jobs.getJob("crawl-test", "owner"))?.error, null);
	const page = (index: number, overrides: Partial<PageCommit> = {}): PageCommit => ({
		id: pageCommitId("crawl-test", index),
		jobId: "crawl-test",
		pageIndex: index,
		resultKey: `results/crawl-test/${index}`,
		status: "ok",
		engine: "fetch",
		credits: 1,
		createdAt: new Date("2026-09-06T00:00:00Z"),
		...overrides,
	});
	const [first, duplicate] = await Promise.all([
		pages.commit({ page: page(0), userId: "owner", countsTowardsTotal: true }),
		pages.commit({
			page: page(0, { resultKey: "results/second", credits: 5 }),
			userId: "owner",
			countsTowardsTotal: true,
		}),
	]);
	assert.deepEqual(first, duplicate);
	assert.equal((await jobs.getJob("crawl-test", "owner"))?.succeeded, 1);
	assert.equal((await jobs.getJob("crawl-test", "owner"))?.creditsUsed, first.credits);
	assert.equal((await db.select().from(schema.usageEvents)).length, 1);
	const failed = page(1, { status: "error", credits: 0 });
	await pages.commit({ page: failed, userId: "owner", countsTowardsTotal: true });
	await pages.commit({ page: failed, userId: "owner", countsTowardsTotal: true });
	assert.equal((await jobs.getJob("crawl-test", "owner"))?.failed, 1);
	assert.equal((await jobs.getJob("crawl-test", "owner"))?.total, 2);
	assert.equal((await db.select().from(schema.usageEvents)).length, 1);
	// A trigger forces the LAST statement to fail: preceding ledger/counter writes must roll back.
	await binding
		.prepare(
			"CREATE TRIGGER reject_test_page BEFORE INSERT ON job_pages WHEN NEW.page_index = 2 BEGIN SELECT RAISE(ABORT, 'forced marker failure'); END",
		)
		.run();
	await assert.rejects(pages.commit({ page: page(2), userId: "owner", countsTowardsTotal: true }));
	assert.equal(await pages.get(pageCommitId("crawl-test", 2)), undefined);
	assert.equal((await jobs.getJob("crawl-test", "owner"))?.total, 2);
	assert.equal((await db.select().from(schema.usageEvents)).length, 1);
	await binding.prepare("DROP TRIGGER reject_test_page").run();
	await pages.commit({ page: page(2), userId: "owner", countsTowardsTotal: true });
	assert.equal((await jobs.getJob("crawl-test", "owner"))?.total, 3);
	assert.equal((await db.select().from(schema.usageEvents)).length, 2);
	await assert.rejects(pages.commit({ page: page(3), userId: "different-owner", countsTowardsTotal: true }));
	assert.equal(await pages.get(pageCommitId("crawl-test", 3)), undefined);
	assert.equal((await jobs.getJob("crawl-test", "owner"))?.total, 3);
	await jobs.createJob({ id: "batch-test", userId: "owner", type: "batch", total: 10, request: {} });
	await pages.commit({
		page: { ...page(0), id: pageCommitId("batch-test", 0), jobId: "batch-test" },
		userId: "owner",
		countsTowardsTotal: false,
	});
	assert.equal((await jobs.getJob("batch-test", "owner"))?.total, 10);
	await pages.commit({ page: page(10), userId: "owner", countsTowardsTotal: true });
	assert.deepEqual(
		(await pages.list("crawl-test", -1, 20, new Date("2026-09-05"))).map((entry) => entry.pageIndex),
		[0, 1, 2, 10],
	);
	assert.deepEqual(
		(await pages.list("crawl-test", 2, 20, new Date("2026-09-05"))).map((entry) => entry.pageIndex),
		[10],
	);
	assert.deepEqual(await pages.list("crawl-test", -1, 20, new Date("2026-09-06")), []);
	assert.equal(await pages.hasPages("crawl-test"), true);
	process.stdout.write(
		"D1 page accounting passed: migrations, concurrent duplicate winner, one usage row, unbilled failure, transaction rollback/retry, owner guard, batch total.\n",
	);
} finally {
	await runtime.dispose();
}
