import { APIError } from "better-auth/api";

import type { AppConfig } from "../env";
import { MAX_API_KEYS_PER_ACCOUNT } from "../ops/limits";

/**
 * Checks that run before Better Auth handles a request (`hooks.before` in `auth.ts`). Kept
 * free of Better Auth's context type so they are unit-testable with plain fakes.
 */

/** The Better Auth endpoint paths these guards act on. */
export const SEND_SIGN_IN_CODE_PATH = "/email-otp/send-verification-otp";
export const CREATE_API_KEY_PATH = "/api-key/create";

/**
 * Every Better Auth 1.6.26 endpoint that calls the email-OTP plugin's `sendVerificationOTP`
 * for an unauthenticated caller: our sign-in path, plus the password-reset requests
 * (`/email-otp/request-password-reset` and its deprecated alias `/forget-password/email-otp`),
 * which mail existing users. (`/email-otp/request-email-change` needs a session and is off.)
 * All of them get the Turnstile check and the fail-closed guard, although only sign-in codes
 * are ever mailed (`isMailedOtpType`).
 */
export const OTP_SEND_PATHS: readonly string[] = [
	SEND_SIGN_IN_CODE_PATH,
	"/email-otp/request-password-reset",
	"/forget-password/email-otp",
];

/**
 * The only OTP type we email. Passwords are off in production and email verification is not
 * wired to the plugin (`overrideDefaultEmailVerification`/`sendVerificationOnSignUp` unset), so
 * `forget-password`, `email-verification` and `change-email` codes are never mailed — the
 * plugin would otherwise send them, worded as sign-in codes, to any existing user.
 */
export const isMailedOtpType = (type: string): boolean => type === "sign-in";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** A public https deployment — local dev (`http://localhost:5173`) and e2e runs are not. */
export const isProductionBaseUrl = (baseUrl: string): boolean => {
	const url = new URL(baseUrl);
	return url.protocol === "https:" && !LOCAL_HOSTNAMES.has(url.hostname) && !url.hostname.endsWith(".localhost");
};

/**
 * The site key is a checked-in var, the secret a wrangler secret: a production deploy that
 * forgot `wrangler secret put TURNSTILE_SECRET_KEY` would otherwise silently run sign-in
 * without a bot check. That combination is refused instead (fail closed).
 */
export const turnstileSecretMissing = (
	config: Pick<AppConfig, "BASE_URL" | "TURNSTILE_SITE_KEY" | "TURNSTILE_SECRET_KEY">,
): boolean =>
	Boolean(config.TURNSTILE_SITE_KEY) && !config.TURNSTILE_SECRET_KEY && isProductionBaseUrl(config.BASE_URL);

export interface AuthGuardDeps {
	config: Pick<AppConfig, "BASE_URL" | "TURNSTILE_SITE_KEY" | "TURNSTILE_SECRET_KEY">;
	/** The signed-in user, if any — only consulted for key creation. */
	sessionUserId(): Promise<string | undefined>;
	countApiKeys(userId: string): Promise<number>;
	log: Pick<Console, "error">;
}

/**
 * Throws a Better Auth `APIError` to refuse the request, or returns to let it through.
 *
 * - Any OTP-sending path (`OTP_SEND_PATHS`) with Turnstile half-configured in production is a
 *   500 with a loud log line, never a code sent without the bot check.
 * - Creating an API key is refused at `MAX_API_KEYS_PER_ACCOUNT`. A check, not a reservation:
 *   two concurrent creations at 49 can both pass, which a fairness cap tolerates.
 */
export const guardAuthRequest = async (path: string, deps: AuthGuardDeps): Promise<void> => {
	if (OTP_SEND_PATHS.includes(path) && turnstileSecretMissing(deps.config)) {
		deps.log.error("turnstile_secret_missing", {
			reason:
				"TURNSTILE_SITE_KEY is set but TURNSTILE_SECRET_KEY is not; refusing to send sign-in codes without the bot check. Run `wrangler secret put TURNSTILE_SECRET_KEY`.",
		});
		throw new APIError("INTERNAL_SERVER_ERROR", {
			message: "Sign-in is temporarily unavailable. Please try again later.",
		});
	}

	if (path === CREATE_API_KEY_PATH) {
		const userId = await deps.sessionUserId();
		// No session: the plugin's own handler answers 401.
		if (!userId) return;
		if ((await deps.countApiKeys(userId)) >= MAX_API_KEYS_PER_ACCOUNT) {
			throw new APIError("FORBIDDEN", {
				code: "API_KEY_LIMIT_REACHED",
				message: `An account can hold at most ${MAX_API_KEYS_PER_ACCOUNT} API keys. Revoke an unused key to create a new one.`,
			});
		}
	}
};

/** User columns only the server may write; never accepted from a request body. */
export const SERVER_ONLY_USER_FIELDS = ["stripeCustomerId"] as const;

interface PluginWithUserSchema {
	schema?: { user?: { fields?: object } };
}

/**
 * The Stripe plugin declares `user.stripeCustomerId` without `input: false`, so Better Auth's
 * `update-user`, `sign-up/email` and email-OTP sign-up would accept it from the client — a user
 * could point their metered usage, Checkout and billing portal at another customer. Plugin
 * schemas override `user.additionalFields`, so the flag has to be set on the plugin itself.
 */
export const lockServerOnlyUserFields = <P extends PluginWithUserSchema>(plugin: P): P => {
	const fields = plugin.schema?.user?.fields as Record<string, { input?: boolean } | undefined> | undefined;
	for (const name of SERVER_ONLY_USER_FIELDS) {
		const field = fields?.[name];
		if (field) {
			field.input = false;
		}
	}
	return plugin;
};
