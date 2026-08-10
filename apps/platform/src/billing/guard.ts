import { PlatformError } from "../core/types";
import type { AppConfig } from "../env";
import { FREE_MONTHLY_CREDITS } from "./credits";
import type { BillingRepo } from "./repo";
import { isSpendable } from "./state";

export interface BillingDeps {
	repo: BillingRepo;
	config: AppConfig;
}

/** Start of the current calendar month in UTC — the window the free allowance resets on. */
export const monthStart = (now: Date = new Date()): Date =>
	new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * Fail-closed spend guard, run **before** any side effect.
 *
 * An active subscription spends freely (Stripe meters it). Everyone else — including every
 * user of a self-hosted deployment without Stripe configured — is capped at the free monthly
 * allowance, measured against the local D1 ledger so the hot path never calls Stripe.
 */
export const ensureSpendable = async (deps: BillingDeps, userId: string, now: Date = new Date()): Promise<void> => {
	const state = await deps.repo.getBillingState(userId);
	if (isSpendable(state)) return;

	const used = await deps.repo.sumMonthCredits(userId, monthStart(now));
	if (used < FREE_MONTHLY_CREDITS) return;

	throw new PlatformError(
		"payment_required",
		deps.config.billingEnabled
			? `Free monthly allowance of ${FREE_MONTHLY_CREDITS} credits is used up. Start a subscription to continue.`
			: `Free monthly allowance of ${FREE_MONTHLY_CREDITS} credits is used up and billing is not configured on this deployment.`,
		402,
	);
};
