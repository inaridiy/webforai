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
}

/** Only `active` unlocks spending beyond the free monthly allowance. */
export const isSpendable = (state: BillingState | undefined): boolean => state?.status === "active";

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
 * Idempotent write — webhooks are delivered at-least-once and out of order is possible, so
 * the row is always fully rewritten from the event we just processed rather than mutated
 * field by field.
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

const mirrorSubscription = async (db: PlatformDb, subscription: Stripe.Subscription, status: BillingStatus) => {
	const stripeCustomerId = customerIdOf(subscription.customer);
	if (!stripeCustomerId) return;
	const userId = await findUserIdByCustomer(db, stripeCustomerId);
	if (!userId) return;
	await upsertBillingState(db, {
		userId,
		stripeCustomerId,
		status,
		stripeSubscriptionId: subscription.id,
		currentPeriodEnd: periodEndOf(subscription),
	});
};

/**
 * Mirrors Stripe subscription lifecycle into `billing_state` so the hot path never calls
 * Stripe. Wired from the Better Auth stripe plugin's `onEvent` (its own subscription model
 * covers fixed plans only and is disabled here).
 *
 * Unknown event types are ignored — this must never throw for an event we do not model,
 * because the plugin turns a throw into a 400 and Stripe would retry forever.
 */
export const mirrorStripeEvent = async (db: PlatformDb, event: Stripe.Event): Promise<void> => {
	switch (event.type) {
		case "customer.subscription.created":
		case "customer.subscription.updated": {
			const subscription = event.data.object;
			await mirrorSubscription(db, subscription, mapSubscriptionStatus(subscription.status));
			return;
		}
		case "customer.subscription.deleted": {
			await mirrorSubscription(db, event.data.object, "canceled");
			return;
		}
		case "invoice.payment_failed": {
			const stripeCustomerId = customerIdOf(event.data.object.customer);
			if (!stripeCustomerId) return;
			const userId = await findUserIdByCustomer(db, stripeCustomerId);
			if (!userId) return;
			const current = await getBillingState(db, userId);
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
