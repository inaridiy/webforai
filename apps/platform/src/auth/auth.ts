import { apiKey } from "@better-auth/api-key";
import { stripe as stripePlugin } from "@better-auth/stripe";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { mirrorStripeEvent } from "../billing/state";
import { createStripe } from "../billing/stripe";
import { createDb } from "../db/client";
import * as schema from "../db/schema";
import type { AppConfig } from "../env";

const DAY_SECONDS = 24 * 60 * 60;

/** Per-key rate limit: generous enough for scripted use, low enough to bound abuse. */
const API_KEY_RATE_LIMIT = { enabled: true, timeWindow: 60 * 1000, maxRequests: 120 };

/**
 * Better Auth instance factory.
 *
 * Must be called **per request**: the D1 binding only exists inside a request, so a
 * module-scope singleton would capture a dead handle.
 *
 * The stripe plugin is used solely for customer creation (`createCustomerOnSignUp`) and
 * webhook plumbing at `/api/auth/stripe/webhook` — its subscription model covers fixed plans
 * only, and our price is metered. Subscription state is therefore mirrored into
 * `billing_state` from `onEvent` (see `src/billing/state.ts`), and checkout/portal/meter
 * calls go through the Stripe SDK directly.
 */
export const createAuth = (env: Env, config: AppConfig) => {
	const db = createDb(env);
	const stripeClient = createStripe(config);
	const webhookSecret = config.STRIPE_WEBHOOK_SECRET;

	// Narrowed here rather than trusting `githubLoginEnabled` alone, so the option object is
	// only built when both halves of the credential pair really exist.
	const github =
		config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET
			? { clientId: config.GITHUB_CLIENT_ID, clientSecret: config.GITHUB_CLIENT_SECRET }
			: undefined;

	const billing =
		stripeClient && webhookSecret
			? [
					stripePlugin({
						stripeClient,
						stripeWebhookSecret: webhookSecret,
						createCustomerOnSignUp: true,
						onEvent: async (event) => {
							await mirrorStripeEvent(db, event);
						},
					}),
				]
			: [];

	return betterAuth({
		database: drizzleAdapter(db, { provider: "sqlite", schema }),
		baseURL: config.BASE_URL,
		secret: config.BETTER_AUTH_SECRET,
		emailAndPassword: { enabled: true },
		...(config.githubLoginEnabled && github ? { socialProviders: { github } } : {}),
		plugins: [
			apiKey({
				defaultPrefix: "wfa_",
				defaultKeyLength: 48,
				requireName: true,
				rateLimit: API_KEY_RATE_LIMIT,
				keyExpiration: { defaultExpiresIn: null },
				// Keys are only ever minted for the session user; never for a client-supplied id.
				enableSessionForAPIKeys: false,
				enableMetadata: false,
				startingCharactersConfig: { shouldStore: true, charactersLength: 10 },
			}),
			...billing,
		],
		// Better Auth session durations are expressed in seconds.
		session: { expiresIn: 30 * DAY_SECONDS, updateAge: DAY_SECONDS },
	});
};

export type Auth = ReturnType<typeof createAuth>;
