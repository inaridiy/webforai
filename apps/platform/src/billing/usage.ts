import type Stripe from "stripe";
import { ulid } from "../core/ulid";
import type { AppConfig } from "../env";
import type { BillingRepo, UnreportedUsage, UsageCursor } from "./repo";

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

/** The fields of a `StripeError` the queue classifies on (stripe@22 `Error.d.ts`). */
interface StripeErrorLike {
	type?: unknown;
	code?: unknown;
	param?: unknown;
	message?: unknown;
	statusCode?: unknown;
	requestId?: unknown;
}

const asStripeError = (error: unknown): StripeErrorLike =>
	typeof error === "object" && error !== null ? (error as StripeErrorLike) : {};

/**
 * Rejections that name our configuration (the meter's event name, an archived or missing
 * meter) rather than the row: every row would fail the same way, so they stop the pass like a
 * transient error instead of draining the whole queue into `rejected`.
 */
const CONFIG_REJECTION_CODES = new Set(["archived_meter", "no_meter"]);

/**
 * Classifies a failed meter call.
 *
 * - `duplicate`: Stripe already holds an event with this identifier — the row is billed (an
 *   earlier attempt landed but marking it in D1 failed, or a concurrent pass sent it).
 * - `rejected`: a `StripeInvalidRequestError` (stripe@22 raises it for 400/404 only; 429 and
 *   400 `rate_limit` become `StripeRateLimitError`) about this event — unknown or deleted
 *   customer, e.g. after switching test→live keys. Retrying cannot help.
 * - `retry`: everything else — connection, 5xx, 409 lock timeout, rate limit, authentication
 *   or permission (a key problem, not a row problem), configuration-level rejections, or a D1
 *   failure marking the row. The pass stops until the next run.
 *
 * Stripe documents identifier uniqueness for meter events but not the error it returns for a
 * repeat, so the duplicate match is deliberately conservative (an assumption, see
 * docs/specs/platform/04_billing.md): code `resource_already_exists`, or a message saying the
 * identifier already exists / is a duplicate. Anything less specific is `rejected` — logged,
 * and re-queueable by an operator inside the 35-day window — never silently `reported`.
 */
export const classifyMeterError = (error: unknown): "duplicate" | "rejected" | "retry" => {
	const { type, code, param, message } = asStripeError(error);
	if (type !== "StripeInvalidRequestError") return "retry";
	const text = typeof message === "string" ? message : "";
	if (
		code === "resource_already_exists" ||
		(/already exists|duplicate/i.test(text) && (param === "identifier" || /identifier/i.test(text)))
	) {
		return "duplicate";
	}
	if (param === "event_name" || (typeof code === "string" && CONFIG_REJECTION_CODES.has(code))) return "retry";
	return "rejected";
};

/**
 * Reconciliation pass for ledger rows whose meter event never landed (Stripe outage, 429,
 * Worker eviction). Cron-driven; safe to run repeatedly: the meter event identifier is the
 * row id.
 *
 * Before draining, rows that can never be billed leave the queue — usage of users without a
 * Stripe customer (free usage) and rows past the meter's 35-day window (logged: that is lost
 * revenue) — so they cannot starve billable rows. The queue is then drained oldest-first by
 * keyset, `pageSize` rows at a time for up to `maxPages` pages (bounding one cron invocation's
 * Stripe calls and subrequests). A row Stripe rejects for good is logged and marked `rejected`
 * so it leaves the queue — otherwise every pass would restart on the same rejected rows and
 * starve newer billable ones; a row Stripe already holds (duplicate identifier) is marked
 * reported. See `classifyMeterError`.
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

/** One queued row: reported, or out of the queue as rejected; throws when the pass must stop. */
const settleRow = async (deps: UsageDeps, row: UnreportedUsage): Promise<"reported" | "rejected"> => {
	try {
		await reportToStripe(deps, row);
		return "reported";
	} catch (error) {
		const verdict = classifyMeterError(error);
		if (verdict === "retry") throw error;
		const { code, param, statusCode, requestId } = asStripeError(error);
		const detail = { id: row.id, code, param, statusCode, requestId, error: String(error) };
		if (verdict === "duplicate") {
			console.info("usage_report_duplicate", detail);
			await deps.repo.markReported(row.id, deps.now?.() ?? new Date());
			return "reported";
		}
		await deps.repo.markRejected(row.id);
		// Enough for an operator to fix the customer and re-queue the row (see 04_billing.md).
		console.error("usage_report_rejected", {
			...detail,
			userId: row.userId,
			stripeCustomerId: row.stripeCustomerId,
			credits: row.credits,
			createdAt: row.createdAt.toISOString(),
		});
		return "rejected";
	}
};

const drainQueue = async (deps: UsageDeps, pageSize: number, maxPages: number): Promise<number> => {
	let reported = 0;
	let after: UsageCursor | undefined;
	for (let page = 0; page < maxPages; page += 1) {
		const rows = await deps.repo.listUnreported(pageSize, after);
		for (const row of rows) {
			try {
				if ((await settleRow(deps, row)) === "reported") reported += 1;
			} catch (error) {
				console.warn("usage_report_retry_stopped", { id: row.id, error: String(error) });
				return reported;
			}
		}
		const last = rows.at(-1);
		if (!last || rows.length < pageSize) break;
		after = { createdAt: last.createdAt, id: last.id };
	}
	return reported;
};
