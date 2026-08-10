import Stripe from "stripe";
import type { AppConfig } from "../env";

/**
 * Stripe client for the Workers runtime: the Node http client is unavailable, so the
 * fetch-based one is mandatory. Returns `undefined` when billing is not fully configured —
 * callers must treat that as "billing off" (free allowance only), never as an error to
 * swallow silently.
 */
export const createStripe = (config: AppConfig): Stripe | undefined => {
	if (!(config.billingEnabled && config.STRIPE_SECRET_KEY)) return undefined;
	return new Stripe(config.STRIPE_SECRET_KEY, {
		httpClient: Stripe.createFetchHttpClient(),
		// Workers have no long-lived process; keep retries bounded so a request never hangs.
		maxNetworkRetries: 2,
	});
};
