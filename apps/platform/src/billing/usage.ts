import type Stripe from "stripe";
import { ulid } from "../core/ulid";
import type { AppConfig } from "../env";
import type { BillingRepo } from "./repo";

export interface UsageDeps {
	repo: BillingRepo;
	config: AppConfig;
	/** Absent when billing is not configured — the D1 ledger is then the only record. */
	stripe?: Stripe | undefined;
	/** Workers `ctx.waitUntil`; when given, the Stripe call is not awaited by the response. */
	waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
	now?: (() => Date) | undefined;
}

export interface RecordUsageParams {
	userId: string;
	stripeCustomerId?: string | null;
	jobId?: string | null;
	operation: string;
	credits: number;
}

/** Reports one ledger row to the Stripe meter and marks it reported on success. */
const reportToStripe = async (
	deps: UsageDeps,
	params: { id: string; stripeCustomerId: string; credits: number },
): Promise<void> => {
	const { stripe } = deps;
	if (!stripe) return;
	await stripe.billing.meterEvents.create({
		event_name: deps.config.STRIPE_METER_EVENT_NAME,
		// The ULID doubles as Stripe's idempotency key (deduplicated for >= 24h).
		identifier: params.id,
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
	const reporting = reportToStripe(deps, { id, stripeCustomerId, credits: params.credits }).catch(() => undefined);
	if (deps.waitUntil) deps.waitUntil(reporting);
	else await reporting;

	return id;
};

/**
 * Reconciliation pass for ledger rows whose meter event never landed (Stripe outage, 429,
 * Worker eviction). Safe to run repeatedly: the meter event identifier is the row id.
 * Intended for a cron trigger.
 */
export const retryUnreportedUsage = async (deps: UsageDeps, limit = 100): Promise<number> => {
	if (!(deps.config.billingEnabled && deps.stripe)) return 0;

	const pending = await deps.repo.listUnreported(limit);
	let reported = 0;
	for (const row of pending) {
		if (!row.stripeCustomerId) continue;
		try {
			await reportToStripe(deps, { id: row.id, stripeCustomerId: row.stripeCustomerId, credits: row.credits });
			reported += 1;
		} catch {
			// Leave the row unreported; the next pass retries it.
		}
	}
	return reported;
};
