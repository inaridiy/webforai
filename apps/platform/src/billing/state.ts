import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import type { PlatformDb } from "../db/client";
import { billingState, user } from "../db/schema";

export type BillingStatus = "none" | "active" | "past_due" | "canceled";

export interface BillingState {
	userId: string;
	stripeCustomerId: string | null;
	status: BillingStatus;
	stripeSubscriptionId: string | null;
	currentPeriodEnd: Date | null;
	/** User-set monthly spend cap in dollars; `null` means the default (`billing/guard.ts`). */
	spendCapUsd: number | null;
}

/** Only `active` unlocks spending beyond the free monthly allowance. */
export const isSpendable = (state: BillingState | undefined): boolean => state?.status === "active";

/** Stripe statuses that bill (or will retry billing): a second Checkout would duplicate them. */
const LIVE_STRIPE_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due", "unpaid"]);

/**
 * Whether the local mirror, or any of the customer's Stripe subscriptions, is still live —
 * Checkout must then refuse to create another subscription.
 */
export const hasLiveSubscription = (
	source: Pick<BillingState, "status"> | readonly Pick<Stripe.Subscription, "status">[] | undefined,
): boolean => {
	if (!source) return false;
	if (Array.isArray(source)) return source.some((subscription) => LIVE_STRIPE_STATUSES.has(subscription.status));
	const state = source as Pick<BillingState, "status">;
	return state.status === "active" || state.status === "past_due";
};

export const getBillingState = async (db: PlatformDb, userId: string): Promise<BillingState | undefined> => {
	const rows = await db.select().from(billingState).where(eq(billingState.userId, userId)).limit(1);
	const row = rows[0];
	if (!row) return undefined;
	return {
		userId: row.userId,
		stripeCustomerId: row.stripeCustomerId,
		status: row.status,
		stripeSubscriptionId: row.stripeSubscriptionId,
		currentPeriodEnd: row.currentPeriodEnd,
		spendCapUsd: row.spendCapUsd,
	};
};

export interface UpsertBillingStateParams {
	userId: string;
	status: BillingStatus;
	stripeCustomerId?: string | null;
	stripeSubscriptionId?: string | null;
	currentPeriodEnd?: Date | null;
	now?: Date;
}

/**
 * Idempotent write of the subscription mirror: the subscription fields are always fully
 * rewritten rather than mutated field by field. The user's spend cap is not part of the mirror
 * and survives every rewrite.
 */
export const upsertBillingState = async (db: PlatformDb, params: UpsertBillingStateParams): Promise<void> => {
	const updatedAt = params.now ?? new Date();
	const values = {
		userId: params.userId,
		status: params.status,
		stripeCustomerId: params.stripeCustomerId ?? null,
		stripeSubscriptionId: params.stripeSubscriptionId ?? null,
		currentPeriodEnd: params.currentPeriodEnd ?? null,
		updatedAt,
	};
	await db.insert(billingState).values(values).onConflictDoUpdate({ target: billingState.userId, set: values });
};

/** Stores the user's spend cap, creating the row (status `none`) when no subscription exists yet. */
export const setSpendCap = async (db: PlatformDb, userId: string, spendCapUsd: number, now: Date): Promise<void> => {
	await db
		.insert(billingState)
		.values({ userId, status: "none", spendCapUsd, updatedAt: now })
		.onConflictDoUpdate({ target: billingState.userId, set: { spendCapUsd, updatedAt: now } });
};

/** Stripe's subscription lifecycle collapsed onto the four states the API cares about. */
export const mapSubscriptionStatus = (status: Stripe.Subscription.Status): BillingStatus => {
	switch (status) {
		case "active":
		case "trialing":
			return "active";
		case "past_due":
		case "unpaid":
			return "past_due";
		case "canceled":
		case "incomplete_expired":
			return "canceled";
		default:
			return "none";
	}
};

const findUserIdByCustomer = async (db: PlatformDb, stripeCustomerId: string): Promise<string | undefined> => {
	const rows = await db.select({ id: user.id }).from(user).where(eq(user.stripeCustomerId, stripeCustomerId)).limit(1);
	return rows[0]?.id;
};

const customerIdOf = (value: string | { id: string } | null | undefined): string | undefined => {
	if (!value) return undefined;
	return typeof value === "string" ? value : value.id;
};

/** `current_period_end` moved onto subscription items in recent Stripe API versions. */
const periodEndOf = (subscription: Stripe.Subscription): Date | null => {
	const ends = subscription.items.data.map((item) => item.current_period_end).filter((end) => typeof end === "number");
	if (ends.length === 0) return null;
	return new Date(Math.max(...ends) * 1000);
};

const LIVE_STATUSES: ReadonlySet<BillingStatus> = new Set(["active", "past_due"]);

const mirrorSubscription = async (db: PlatformDb, subscription: Stripe.Subscription, status: BillingStatus) => {
	const stripeCustomerId = customerIdOf(subscription.customer);
	if (!stripeCustomerId) return;
	const userId = await findUserIdByCustomer(db, stripeCustomerId);
	if (!userId) return;
	const current = await getBillingState(db, userId);
	// A late event about an older, ended subscription must not demote the live one.
	if (
		current?.stripeSubscriptionId &&
		current.stripeSubscriptionId !== subscription.id &&
		LIVE_STATUSES.has(current.status) &&
		status !== "active"
	) {
		return;
	}
	await upsertBillingState(db, {
		userId,
		stripeCustomerId,
		status,
		stripeSubscriptionId: subscription.id,
		currentPeriodEnd: periodEndOf(subscription),
	});
};

/** The slice of the Stripe client the mirror re-fetches subscriptions with. */
export type SubscriptionFetcher = Pick<Stripe, "subscriptions">;

/**
 * Mirrors Stripe subscription lifecycle into `billing_state` so the hot path never calls
 * Stripe. Wired from the Better Auth stripe plugin's `onEvent` (its own subscription model
 * covers fixed plans only and is disabled here).
 *
 * Stripe delivers events at least once and in no guaranteed order (`created` and `updated`
 * for one checkout often share a second), so with a client the event is only a trigger: the
 * subscription is re-fetched and its *current* state mirrored, which makes a late or repeated
 * event harmless. Without a client the event payload is mirrored as-is.
 *
 * Unknown event types are ignored — this must never throw for an event we do not model,
 * because the plugin turns a throw into a 400 and Stripe would retry forever. A failed
 * re-fetch does throw: that retry is wanted.
 */
export const mirrorStripeEvent = async (
	db: PlatformDb,
	event: Stripe.Event,
	stripe?: SubscriptionFetcher | undefined,
): Promise<void> => {
	switch (event.type) {
		case "customer.subscription.created":
		case "customer.subscription.updated":
		case "customer.subscription.deleted": {
			if (stripe) {
				const subscription = await stripe.subscriptions.retrieve(event.data.object.id);
				await mirrorSubscription(db, subscription, mapSubscriptionStatus(subscription.status));
				return;
			}
			const subscription = event.data.object;
			const status =
				event.type === "customer.subscription.deleted" ? "canceled" : mapSubscriptionStatus(subscription.status);
			await mirrorSubscription(db, subscription, status);
			return;
		}
		case "invoice.payment_failed": {
			const stripeCustomerId = customerIdOf(event.data.object.customer);
			if (!stripeCustomerId) return;
			const userId = await findUserIdByCustomer(db, stripeCustomerId);
			if (!userId) return;
			const current = await getBillingState(db, userId);
			if (stripe && current?.stripeSubscriptionId) {
				// The subscription's own status is the truth (a final invoice failing after a
				// cancellation must not resurrect it as past_due).
				const subscription = await stripe.subscriptions.retrieve(current.stripeSubscriptionId);
				await mirrorSubscription(db, subscription, mapSubscriptionStatus(subscription.status));
				return;
			}
			await upsertBillingState(db, {
				userId,
				stripeCustomerId,
				status: "past_due",
				stripeSubscriptionId: current?.stripeSubscriptionId ?? null,
				currentPeriodEnd: current?.currentPeriodEnd ?? null,
			});
			return;
		}
		default:
			return;
	}
};
