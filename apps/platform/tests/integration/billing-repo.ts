/**
 * Billing SQL against disposable workerd D1 with the checked-in migrations: the usage report
 * queue (customer join, keyset paging, customerless/expired/rejected rows leaving the queue,
 * rejected head rows no longer starving newer billable ones), the spend
 * cap surviving subscription mirror rewrites, and the webhook mirror re-fetching subscriptions
 * so out-of-order or stale events cannot regress the stored state.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import Stripe from "stripe";
import { createBillingRepo } from "../../src/billing/repo";
import { type SubscriptionFetcher, mirrorStripeEvent, upsertBillingState } from "../../src/billing/state";
import { retryUnreportedUsage } from "../../src/billing/usage";
import * as schema from "../../src/db/schema";
import type { AppConfig } from "../../src/env";

const StripeErrors = Stripe.errors;
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const runtime = new Miniflare({
	modules: true,
	script: "export default { fetch() { return new Response('ok'); } }",
	d1Databases: ["DB"],
});

const now = new Date("2026-10-01T00:00:00Z");
const at = (minute: number) => new Date(Date.UTC(2026, 8, 30, 0, minute));

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
	const repo = createBillingRepo(db);

	const seedUser = (id: string, stripeCustomerId: string | null) =>
		db.insert(schema.user).values({
			id,
			name: id,
			email: `${id}@example.test`,
			emailVerified: true,
			stripeCustomerId,
			createdAt: now,
			updatedAt: now,
		});
	await seedUser("paid", "cus_paid");
	await seedUser("free", null);

	const usage = (id: string, userId: string, createdAt: Date, reportedAt: Date | null = null) => ({
		id,
		userId,
		operation: "fetch",
		credits: 1,
		createdAt,
		reportedAt,
	});
	// 150 customerless rows ahead of every billable one: the old queue stalled on exactly this.
	// Inserted in chunks: D1 caps bound parameters at 100 per statement.
	for (let chunk = 0; chunk < 15; chunk += 1) {
		await db
			.insert(schema.usageEvents)
			.values(Array.from({ length: 10 }, (_, i) => usage(`free-${chunk}-${i}`, "free", at(0))));
	}
	// A deleted user's orphaned row has no user at all.
	await db.insert(schema.usageEvents).values(usage("orphan", "gone", at(0)));
	await db
		.insert(schema.usageEvents)
		.values([
			usage("old", "paid", new Date("2026-08-01T00:00:00Z")),
			usage("p1", "paid", at(1)),
			usage("p2b", "paid", at(2)),
			usage("p2a", "paid", at(2)),
			usage("p3", "paid", at(3)),
			usage("done", "paid", at(1), now),
		]);

	// 1. The queue lists only customers' pending rows, oldest first, with a stable keyset.
	const first = await repo.listUnreported(2);
	assert.deepEqual(
		first.map((row) => row.id),
		["old", "p1"],
	);
	assert.equal(first[0]?.stripeCustomerId, "cus_paid");
	// biome-ignore lint/style/noNonNullAssertion: asserted above
	const last = first[1]!;
	const second = await repo.listUnreported(2, { createdAt: last.createdAt, id: last.id });
	assert.deepEqual(
		second.map((row) => row.id),
		["p2a", "p2b"],
	);

	// 2. Customerless rows (including orphans) leave the queue, explicitly marked.
	assert.equal(await repo.skipCustomerless(), 151);
	assert.equal(await repo.skipCustomerless(), 0);
	const orphan = (await db.select().from(schema.usageEvents).where(eq(schema.usageEvents.id, "orphan")))[0];
	assert.equal(orphan?.reportSkippedReason, "no_customer");
	assert.equal(orphan?.reportedAt, null);

	// 3. Rows past the meter window leave the queue and are returned for logging.
	const expired = await repo.skipExpired(new Date("2026-09-01T00:00:00Z"));
	assert.deepEqual(expired, [{ id: "old", credits: 1 }]);
	assert.deepEqual(
		(await repo.listUnreported(100)).map((row) => row.id),
		["p1", "p2a", "p2b", "p3"],
	);
	// Backlog: billable pending rows older than the cutoff (p1 at 00:01, p2a/p2b at 00:02).
	assert.deepEqual(await repo.pendingBacklog(at(2)), { count: 1, oldest: at(1) });
	assert.equal(await repo.pendingBacklog(at(0)), undefined);

	// The query is served by the partial index.
	const plan = await binding
		.prepare(
			"EXPLAIN QUERY PLAN SELECT id FROM usage_events WHERE reported_at IS NULL AND report_skipped_reason IS NULL ORDER BY created_at, id LIMIT 100",
		)
		.all<{ detail: string }>();
	assert.ok(
		plan.results.some((row) => row.detail.includes("usage_pending_report_idx")),
		JSON.stringify(plan.results),
	);

	// 3b. Rejected rows leave the queue; a pass reaches the billable rows behind them, a row
	// Stripe already holds is marked reported, and a later pass does not revisit the rejected.
	await seedUser("stale", "cus_test_only");
	for (let chunk = 0; chunk < 3; chunk += 1) {
		await db
			.insert(schema.usageEvents)
			.values(Array.from({ length: 10 }, (_, i) => usage(`stale-${chunk}-${i}`, "stale", at(0))));
	}
	const sent: string[] = [];
	const meter = {
		billing: {
			meterEvents: {
				create: async (params: { identifier: string; payload: { stripe_customer_id: string } }) => {
					sent.push(params.identifier);
					if (params.payload.stripe_customer_id === "cus_test_only") {
						throw new StripeErrors.StripeInvalidRequestError({
							message: "No such customer: 'cus_test_only'",
							code: "resource_missing",
							statusCode: 400,
						});
					}
					if (params.identifier === "p2a") {
						throw new StripeErrors.StripeInvalidRequestError({
							message: "An event with identifier 'p2a' already exists.",
							code: "resource_already_exists",
							statusCode: 400,
						});
					}
					return {};
				},
			},
		},
	} as unknown as Stripe;
	const config = { billingEnabled: true, STRIPE_METER_EVENT_NAME: "webforai_credits" } as AppConfig;
	const { error: logError, info: logInfo } = console;
	console.error = () => undefined;
	console.info = () => undefined;
	try {
		// pageSize 10 x 4 pages: 30 rejected rows ahead, the 4 billable rows still land.
		assert.equal(await retryUnreportedUsage({ repo, config, stripe: meter, now: () => now }, 10, 4), 4);
	} finally {
		console.error = logError;
		console.info = logInfo;
	}
	assert.deepEqual(await repo.listUnreported(100), []);
	const stale = await db.select().from(schema.usageEvents).where(eq(schema.usageEvents.userId, "stale"));
	assert.equal(stale.length, 30);
	assert.ok(stale.every((row) => row.reportSkippedReason === "rejected" && row.reportedAt === null));
	const p2a = (await db.select().from(schema.usageEvents).where(eq(schema.usageEvents.id, "p2a")))[0];
	assert.ok(p2a?.reportedAt && p2a.reportSkippedReason === null);
	sent.length = 0;
	assert.equal(await retryUnreportedUsage({ repo, config, stripe: meter, now: () => now }, 10, 4), 0);
	assert.deepEqual(sent, []);
	// markRejected never touches a row already reported.
	await repo.markRejected("p1");
	const p1 = (await db.select().from(schema.usageEvents).where(eq(schema.usageEvents.id, "p1")))[0];
	assert.equal(p1?.reportSkippedReason, null);

	// 4. Spend cap: created on demand, preserved across mirror rewrites.
	await repo.setSpendCap("free", 20, now);
	assert.equal((await repo.getBillingState("free"))?.spendCapUsd, 20);
	assert.equal((await repo.getBillingState("free"))?.status, "none");
	await upsertBillingState(db, {
		userId: "free",
		status: "active",
		stripeCustomerId: "cus_free",
		stripeSubscriptionId: "sub_x",
		now,
	});
	assert.equal((await repo.getBillingState("free"))?.spendCapUsd, 20);
	assert.equal((await repo.getBillingState("paid"))?.spendCapUsd ?? null, null);

	// 5. Webhook mirror: the event is a trigger, the re-fetched subscription is the truth.
	const subscriptions = new Map<string, Stripe.Subscription>();
	const subscription = (id: string, status: Stripe.Subscription.Status) =>
		({
			id,
			status,
			customer: "cus_paid",
			items: { data: [{ current_period_end: Date.parse("2026-11-01T00:00:00Z") / 1000 }] },
		}) as unknown as Stripe.Subscription;
	const stripe: SubscriptionFetcher = {
		subscriptions: {
			retrieve: async (id: string) => {
				const found = subscriptions.get(id);
				if (!found) throw new Error(`no ${id}`);
				return found;
			},
		},
	} as unknown as SubscriptionFetcher;
	const event = (type: string, object: Stripe.Subscription) =>
		({ id: `evt_${type}`, type, data: { object } }) as unknown as Stripe.Event;

	// `created` (incomplete) delivered after `updated` (active): the stale payload is ignored.
	subscriptions.set("sub_a", subscription("sub_a", "active"));
	await mirrorStripeEvent(db, event("customer.subscription.updated", subscription("sub_a", "active")), stripe);
	await mirrorStripeEvent(db, event("customer.subscription.created", subscription("sub_a", "incomplete")), stripe);
	assert.equal((await repo.getBillingState("paid"))?.status, "active");
	assert.equal((await repo.getBillingState("paid"))?.stripeSubscriptionId, "sub_a");

	// A late event about an older, ended subscription does not demote the live one.
	subscriptions.set("sub_old", subscription("sub_old", "canceled"));
	await mirrorStripeEvent(db, event("customer.subscription.deleted", subscription("sub_old", "canceled")), stripe);
	assert.equal((await repo.getBillingState("paid"))?.status, "active");
	assert.equal((await repo.getBillingState("paid"))?.stripeSubscriptionId, "sub_a");

	// The live subscription's own cancellation does land.
	subscriptions.set("sub_a", subscription("sub_a", "canceled"));
	await mirrorStripeEvent(db, event("customer.subscription.deleted", subscription("sub_a", "canceled")), stripe);
	assert.equal((await repo.getBillingState("paid"))?.status, "canceled");

	console.log(
		"Billing repo passed: customer-only keyset queue, customerless/expired/rejected rows marked, rejected head rows do not starve billable ones, duplicates count as reported, partial index used, spend cap preserved, webhook mirror re-fetches and ignores stale events.",
	);
} finally {
	await runtime.dispose();
}
