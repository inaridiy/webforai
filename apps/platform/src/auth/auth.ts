import { apiKey } from "@better-auth/api-key";
import { stripe as stripePlugin } from "@better-auth/stripe";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { captcha, emailOTP } from "better-auth/plugins";
import { mirrorStripeEvent } from "../billing/state";
import { createStripe } from "../billing/stripe";
import { createDb } from "../db/client";
import * as schema from "../db/schema";
import type { AppConfig } from "../env";
import { guardAuthRequest } from "./guards";
import { SIGN_IN_CODE_TTL_MINUTES, sendSignInCode } from "./sign-in-email";

const DAY_SECONDS = 24 * 60 * 60;

/** Turnstile action the sign-in widget sends and the server requires. */
export const TURNSTILE_ACTION = "sign-in";

/**
 * The plugin's per-key limiter is off: `/v1` is limited per account by the Workers Rate
 * Limiting bindings in `requireApiKey` (keys are free to create, so a per-key limit bounded
 * nothing). The global `enabled: false` also overrides `rateLimitEnabled` stored on keys
 * created before 2026-10-01. Verification still writes `lastRequest`/`updatedAt` per call.
 */
const API_KEY_RATE_LIMIT = { enabled: false };

/**
 * Better Auth's limiter, persisted in D1: in-memory counters would be per isolate on Workers.
 * `enabled` is explicit because its production auto-detection does not see Workers. The
 * email-OTP plugin adds its own rules (3 sends per minute) on top of this default.
 */
const AUTH_RATE_LIMIT = { enabled: true, storage: "database", window: 60, max: 60 } as const;

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
							await mirrorStripeEvent(db, event, stripeClient);
						},
					}),
				]
			: [];

	// Bot check on sending sign-in codes, only when both Turnstile keys are configured. The
	// hostname allowlist comes from BASE_URL, so production never accepts localhost tokens.
	// A production deployment with the site key but no secret is refused by `guardAuthRequest`
	// rather than served without the check.
	const turnstile =
		config.TURNSTILE_SECRET_KEY && config.TURNSTILE_SITE_KEY
			? [
					captcha({
						provider: "cloudflare-turnstile",
						secretKey: config.TURNSTILE_SECRET_KEY,
						endpoints: ["/email-otp/send-verification-otp"],
						expectedAction: TURNSTILE_ACTION,
						allowedHostnames: [new URL(config.BASE_URL).hostname],
					}),
				]
			: [];

	return betterAuth({
		database: drizzleAdapter(db, { provider: "sqlite", schema }),
		baseURL: config.BASE_URL,
		secret: config.BETTER_AUTH_SECRET,
		// Sign-in is by emailed code; passwords exist only for local runs and e2e seeding.
		emailAndPassword: { enabled: config.passwordLoginEnabled },
		rateLimit: AUTH_RATE_LIMIT,
		// Only Cloudflare sets this header; X-Forwarded-For is caller-controlled.
		advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
		// OAuth failures (e.g. account_not_linked) land on our sign-in page as ?error=<code>
		// instead of Better Auth's generic error page.
		onAPIError: { errorURL: "/login" },
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				await guardAuthRequest(ctx.path, {
					config,
					sessionUserId: async () => (await getSessionFromCtx(ctx))?.user.id,
					countApiKeys: (userId) =>
						ctx.context.adapter.count({ model: "apikey", where: [{ field: "referenceId", value: userId }] }),
					log: console,
				});
			}),
		},
		...(config.githubLoginEnabled && github ? { socialProviders: { github } } : {}),
		plugins: [
			emailOTP({
				otpLength: 6,
				expiresIn: SIGN_IN_CODE_TTL_MINUTES * 60,
				allowedAttempts: 3,
				// Encrypted (not hashed) so a resend within the validity window can re-send the same
				// code: whichever of several emails the user opens, its code works. Hashing made
				// every resend rotate the code and silently invalidate earlier emails.
				storeOTP: "encrypted",
				resendStrategy: "reuse",
				sendVerificationOTP: ({ email, otp }) => sendSignInCode(env.EMAIL, { email, otp, baseUrl: config.BASE_URL }),
			}),
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
			...turnstile,
		],
		// Better Auth session durations are expressed in seconds.
		session: { expiresIn: 30 * DAY_SECONDS, updateAge: DAY_SECONDS },
	});
};

export type Auth = ReturnType<typeof createAuth>;
