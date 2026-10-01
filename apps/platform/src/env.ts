import { z } from "zod";

/**
 * Typed access to vars + secrets. Bindings (DB, KV, R2, ...) come from the generated
 * `worker-configuration.d.ts` Env; this module validates the string-typed part once per
 * request and derives feature availability instead of letting code probe raw env keys.
 */
const envSchema = z.object({
	BASE_URL: z.string().url(),
	BETTER_AUTH_SECRET: z.string().min(32),
	STRIPE_METER_EVENT_NAME: z.string().default("webforai_credits"),

	STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
	STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
	STRIPE_METERED_PRICE_ID: z.string().startsWith("price_").optional(),

	PROXY_URL: z.string().url().optional(),
	PROXY_USERNAME: z.string().optional(),
	PROXY_PASSWORD: z.string().optional(),
	/** The proxy provider's account API (v2 base URL) and key, for the bandwidth guard. */
	PROXY_ACCOUNT_API_URL: z.string().url().optional(),
	PROXY_ACCOUNT_API_KEY: z.string().optional(),

	/** Local/e2e only: re-enables email + password sign-up and sign-in. Never set in production. */
	AUTH_PASSWORD_LOGIN: z.enum(["true", "false"]).optional(),

	/** Cloudflare Turnstile on sign-in-code requests: public site key (var) + secret. */
	TURNSTILE_SITE_KEY: z.string().optional(),
	TURNSTILE_SECRET_KEY: z.string().optional(),

	GITHUB_CLIENT_ID: z.string().optional(),
	GITHUB_CLIENT_SECRET: z.string().optional(),

	/** Operator inbox for ops alerts (bandwidth thresholds, cron failures); unset = log only. */
	OPS_ALERT_EMAIL: z.string().email().optional(),
});

export type AppConfig = z.infer<typeof envSchema> & {
	/** Stripe fully configured — when false, only the free allowance is served. */
	billingEnabled: boolean;
	/** Rotating-proxy gateway configured — gates `proxy-fetch` / `proxy-browser`. */
	proxyEnabled: boolean;
	/** Proxy account API configured — enables the monthly bandwidth guard. */
	proxyBandwidthGuard: boolean;
	githubLoginEnabled: boolean;
	passwordLoginEnabled: boolean;
};

/** Throws on malformed configuration — the Worker must not run half-configured. */
export const loadConfig = (env: Env): AppConfig => {
	const parsed = envSchema.parse(env);
	return {
		...parsed,
		billingEnabled: Boolean(parsed.STRIPE_SECRET_KEY && parsed.STRIPE_WEBHOOK_SECRET && parsed.STRIPE_METERED_PRICE_ID),
		proxyEnabled: Boolean(parsed.PROXY_URL && parsed.PROXY_USERNAME && parsed.PROXY_PASSWORD),
		proxyBandwidthGuard: Boolean(parsed.PROXY_ACCOUNT_API_URL && parsed.PROXY_ACCOUNT_API_KEY),
		githubLoginEnabled: Boolean(parsed.GITHUB_CLIENT_ID && parsed.GITHUB_CLIENT_SECRET),
		passwordLoginEnabled: parsed.AUTH_PASSWORD_LOGIN === "true",
	};
};
