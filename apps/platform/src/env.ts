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

	GITHUB_CLIENT_ID: z.string().optional(),
	GITHUB_CLIENT_SECRET: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema> & {
	/** Stripe fully configured — when false, only the free allowance is served. */
	billingEnabled: boolean;
	/** Rotating-proxy gateway configured — gates `proxy-fetch` / `proxy-browser`. */
	proxyEnabled: boolean;
	githubLoginEnabled: boolean;
};

/** Throws on malformed configuration — the Worker must not run half-configured. */
export const loadConfig = (env: Env): AppConfig => {
	const parsed = envSchema.parse(env);
	return {
		...parsed,
		billingEnabled: Boolean(parsed.STRIPE_SECRET_KEY && parsed.STRIPE_WEBHOOK_SECRET && parsed.STRIPE_METERED_PRICE_ID),
		proxyEnabled: Boolean(parsed.PROXY_URL && parsed.PROXY_USERNAME && parsed.PROXY_PASSWORD),
		githubLoginEnabled: Boolean(parsed.GITHUB_CLIENT_ID && parsed.GITHUB_CLIENT_SECRET),
	};
};
