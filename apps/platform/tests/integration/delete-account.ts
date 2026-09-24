/**
 * Account deletion against disposable workerd D1 with the checked-in migrations: billing is
 * settled first (unreported usage reported, subscription cancelled), a billing failure deletes
 * nothing, and a successful deletion removes every row the user owns while another user's rows
 * stay untouched.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { type DeleteAccountBilling, deleteAccount } from "../../src/account/delete-account";
import * as schema from "../../src/db/schema";
import { createJobsRepo } from "../../src/jobs/repo";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const runtime = new Miniflare({
	modules: true,
	script: "export default { fetch() { return new Response('ok'); } }",
	d1Databases: ["DB"],
});

const now = new Date("2026-09-24T12:00:00Z");

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

	const seedUser = async (id: string, email: string) => {
		await db.insert(schema.user).values({ id, name: id, email, emailVerified: true, createdAt: now, updatedAt: now });
		await db.insert(schema.session).values({
			id: `s-${id}`,
			token: `t-${id}`,
			userId: id,
			expiresAt: new Date("2099-01-01"),
			createdAt: now,
			updatedAt: now,
		});
		await db.insert(schema.account).values({
			id: `a-${id}`,
			accountId: id,
			providerId: "github",
			userId: id,
			createdAt: now,
			updatedAt: now,
		});
		await db.insert(schema.apikey).values({
			id: `k-${id}`,
			key: `hashed-${id}`,
			referenceId: id,
			configId: "default",
			createdAt: now,
			updatedAt: now,
		} as typeof schema.apikey.$inferInsert);
		await createJobsRepo(db).createJob({ id: `job-${id}`, userId: id, type: "crawl", request: {} });
		await db.insert(schema.jobPages).values({
			id: `job-${id}:page:0`,
			jobId: `job-${id}`,
			pageIndex: 0,
			resultKey: `results/job-pages/job-${id}/0/x.json`,
			status: "ok",
			engine: "fetch",
			credits: 1,
			createdAt: now,
		});
		await db.insert(schema.usageEvents).values([
			{ id: `u1-${id}`, userId: id, operation: "fetch", credits: 1, createdAt: now, reportedAt: now },
			{ id: `u2-${id}`, userId: id, operation: "browser", credits: 2, createdAt: now, reportedAt: null },
		]);
		await db.insert(schema.billingState).values({
			userId: id,
			stripeCustomerId: `cus_${id}`,
			status: "active",
			stripeSubscriptionId: `sub_${id}`,
			updatedAt: now,
		});
		await db
			.insert(schema.verification)
			// Better Auth lowercases the email in OTP identifiers.
			.values({
				id: `v-${id}`,
				identifier: `sign-in-otp-${email.toLowerCase()}`,
				value: "x:0",
				expiresAt: new Date("2099-01-01"),
			});
	};
	await seedUser("leaver", "Leaver@Example.test");
	await seedUser("stayer", "stayer@example.test");

	const counts = async (id: string) => ({
		user: (await db.select().from(schema.user).where(eq(schema.user.id, id))).length,
		session: (await db.select().from(schema.session).where(eq(schema.session.userId, id))).length,
		account: (await db.select().from(schema.account).where(eq(schema.account.userId, id))).length,
		apikey: (await db.select().from(schema.apikey).where(eq(schema.apikey.referenceId, id))).length,
		jobs: (await db.select().from(schema.jobs).where(eq(schema.jobs.userId, id))).length,
		pages: (
			await db
				.select()
				.from(schema.jobPages)
				.where(eq(schema.jobPages.jobId, `job-${id}`))
		).length,
		usage: (await db.select().from(schema.usageEvents).where(eq(schema.usageEvents.userId, id))).length,
		billing: (await db.select().from(schema.billingState).where(eq(schema.billingState.userId, id))).length,
	});
	const everything = { user: 1, session: 1, account: 1, apikey: 1, jobs: 1, pages: 1, usage: 2, billing: 1 };

	// 1. Wrong confirmation: nothing happens.
	await assert.rejects(deleteAccount({ db }, { id: "leaver", email: "Leaver@Example.test" }, "someone@else"), {
		code: "invalid_request",
	});

	// 2. Billing failure (subscription cancel) aborts before any row is deleted.
	const failing: DeleteAccountBilling = {
		report: () => Promise.resolve(),
		cancelSubscription: () => Promise.reject(new Error("stripe down")),
	};
	await assert.rejects(
		deleteAccount({ db, billing: failing }, { id: "leaver", email: "Leaver@Example.test" }, "leaver@example.test"),
		{ code: "billing_unavailable" },
	);
	assert.deepEqual(await counts("leaver"), everything);

	// 3. Success: unreported usage is reported, the subscription cancelled, every row removed,
	//    result archives cleaned up, and the other user untouched.
	const reported: string[] = [];
	const cancelled: string[] = [];
	const cleaned: string[] = [];
	await deleteAccount(
		{
			db,
			billing: {
				report: (row) => {
					reported.push(`${row.id}@${row.stripeCustomerId}`);
					return Promise.resolve();
				},
				cancelSubscription: (id) => {
					cancelled.push(id);
					return Promise.resolve();
				},
			},
			deletePrefix: (prefix) => {
				cleaned.push(prefix);
				return Promise.resolve();
			},
		},
		{ id: "leaver", email: "Leaver@Example.test" },
		" leaver@example.test ",
	);
	assert.deepEqual(reported, ["u2-leaver@cus_leaver"]);
	assert.deepEqual(cancelled, ["sub_leaver"]);
	assert.deepEqual(cleaned, ["results/job-pages/job-leaver/"]);
	assert.deepEqual(await counts("leaver"), {
		user: 0,
		session: 0,
		account: 0,
		apikey: 0,
		jobs: 0,
		pages: 0,
		usage: 0,
		billing: 0,
	});
	assert.equal(
		(
			await db
				.select()
				.from(schema.verification)
				.where(eq(schema.verification.identifier, "sign-in-otp-leaver@example.test"))
		).length,
		0,
	);
	assert.deepEqual(await counts("stayer"), everything);

	console.log(
		"Account deletion passed: confirmation required, billing failure deletes nothing, unreported usage reported, subscription cancelled, all rows removed, other users untouched.",
	);
} finally {
	await runtime.dispose();
}
