import type Stripe from "stripe";
import { ulid } from "../core/ulid";
import type { AppConfig } from "../env";
import type { BillingRepo, UsageCursor } from "./repo";

export interface UsageDeps {
	repo: BillingRepo;
	config: AppConfig;
	/** Absent when billing is not configured — the D1 ledger is then the only record. */
	stripe?: Stripe | undefined;
	/** Workers `ctx.waitUntil`; when given, the Stripe call is not awaited by the response. */
	waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
	now?: (() => Date) | undefined;
	/**
	 * Called by the reconciliation pass when billable rows older than `BACKLOG_AGE_MS` remain
	 * after draining (wired to the ops alert); its failure is logged, never thrown.
	 */
	onBacklog?: ((backlog: { count: number; oldest: Date }) => Promise<unknown>) | undefined;
}

/** Unreported billable usage older than this, left after a pass, is an operational problem. */
export const BACKLOG_AGE_MS = 60 * 60 * 1000;

export interface RecordUsageParams {
	userId: string;
	stripeCustomerId?: string | null;
	jobId?: string | null;
	operation: string;
	credits: number;
}

/**
 * Stripe accepts meter events up to 35 days in the past. Rows older than this (with an hour of
 * margin for clock skew and a slow run) can no longer be billed and leave the retry queue.
 */
export const METER_EVENT_MAX_AGE_MS = 35 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;

/** Whether the meter still accepts a usage row created at `createdAt`. */
export const isReportableAge = (createdAt: Date, now: Date): boolean =>
	now.getTime() - createdAt.getTime() < METER_EVENT_MAX_AGE_MS;

export interface MeterReport {
	id: string;
	stripeCustomerId: string;
	credits: number;
	/** When the usage happened — sent as the event timestamp so a late retry lands in its period. */
	createdAt: Date;
}

/** Reports one ledger row to the Stripe meter and marks it reported on success. */
export const reportToStripe = async (deps: UsageDeps, params: MeterReport): Promise<void> => {
	const { stripe } = deps;
	if (!stripe) return;
	await stripe.billing.meterEvents.create({
		event_name: deps.config.STRIPE_METER_EVENT_NAME,
		// The ULID doubles as Stripe's idempotency key (deduplicated for >= 24h).
		identifier: params.id,
		timestamp: Math.floor(params.createdAt.getTime() / 1000),
		payload: { stripe_customer_id: params.stripeCustomerId, value: String(params.credits) },
	});
	await deps.repo.markReported(params.id, deps.now?.() ?? new Date());
};

/**
 * Records a successful operation.
 *
 * The D1 row is written first and is the reconciliation source: if the meter call fails the
 * row simply stays unreported and `retryUnreportedUsage` picks it up later. Never called for
 * failed operations — those are not billed.
 *
 * Returns the ledger id (also the Stripe meter-event identifier).
 */
export const recordUsage = async (deps: UsageDeps, params: RecordUsageParams): Promise<string> => {
	const now = deps.now?.() ?? new Date();
	const id = ulid(now.getTime());

	await deps.repo.insertUsage({
		id,
		userId: params.userId,
		jobId: params.jobId ?? null,
		operation: params.operation,
		credits: params.credits,
		createdAt: now,
		reportedAt: null,
	});

	const { stripeCustomerId } = params;
	if (!(deps.config.billingEnabled && deps.stripe && stripeCustomerId)) return id;

	// A meter failure must never fail the user's request — the ledger row already exists.
	const reporting = reportToStripe(deps, { id, stripeCustomerId, credits: params.credits, createdAt: now }).catch(
		() => undefined,
	);
	if (deps.waitUntil) deps.waitUntil(reporting);
	else await reporting;

	return id;
};

/**
 * A Stripe "invalid request" concerns this one event (unknown customer, duplicate identifier):
 * retrying it now cannot help, but the rows behind it must not be held up. Anything else —
 * connection, 5xx, rate limit, authentication, or a D1 failure marking the row — is the
 * service's trouble, and the pass stops until the next run.
 */
const isEventRejection = (error: unknown): boolean =>
	typeof error === "object" && error !== null && (error as { type?: unknown }).type === "StripeInvalidRequestError";

/**
 * Reconciliation pass for ledger rows whose meter event never landed (Stripe outage, 429,
 * Worker eviction). Cron-driven; safe to run repeatedly: the meter event identifier is the
 * row id.
 *
 * Before draining, rows that can never be billed leave the queue — usage of users without a
 * Stripe customer (free usage) and rows past the meter's 35-day window (logged: that is lost
 * revenue) — so they cannot starve billable rows. The queue is then drained oldest-first by
 * keyset, `pageSize` rows at a time for up to `maxPages` pages (bounding one cron invocation's
 * Stripe calls and subrequests); a row Stripe rejects is logged and passed over, so one bad
 * row cannot block the rest either.
 */
export const retryUnreportedUsage = async (deps: UsageDeps, pageSize = 100, maxPages = 10): Promise<number> => {
	if (!(deps.config.billingEnabled && deps.stripe)) return 0;
	const now = deps.now?.() ?? new Date();

	const customerless = await deps.repo.skipCustomerless();
	if (customerless > 0) {
		console.info("usage_report_skipped_no_customer", { rows: customerless });
	}
	const expired = await deps.repo.skipExpired(new Date(now.getTime() - METER_EVENT_MAX_AGE_MS));
	if (expired.length > 0) {
		console.error("usage_report_expired", {
			rows: expired.length,
			credits: expired.reduce((sum, row) => sum + row.credits, 0),
			ids: expired.slice(0, 20).map((row) => row.id),
		});
	}

	const reported = await drainQueue(deps, pageSize, maxPages);

	if (deps.onBacklog) {
		const backlog = await deps.repo.pendingBacklog(new Date(now.getTime() - BACKLOG_AGE_MS));
		if (backlog) {
			await deps.onBacklog(backlog).catch((error: unknown) => {
				console.error("usage_backlog_alert_failed", { error: String(error) });
			});
		}
	}
	return reported;
};

const drainQueue = async (deps: UsageDeps, pageSize: number, maxPages: number): Promise<number> => {
	let reported = 0;
	let after: UsageCursor | undefined;
	for (let page = 0; page < maxPages; page += 1) {
		const rows = await deps.repo.listUnreported(pageSize, after);
		let rejected = 0;
		for (const row of rows) {
			try {
				await reportToStripe(deps, row);
				reported += 1;
			} catch (error) {
				if (!isEventRejection(error)) {
					console.warn("usage_report_retry_stopped", { id: row.id, error: String(error) });
					return reported;
				}
				rejected += 1;
				console.error("usage_report_rejected", { id: row.id, error: String(error) });
			}
		}
		const last = rows.at(-1);
		// A page Stripe rejected wholesale points at configuration, not at individual rows.
		if (!last || rows.length < pageSize || rejected === rows.length) break;
		after = { createdAt: last.createdAt, id: last.id };
	}
	return reported;
};
