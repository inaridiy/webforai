/**
 * Generation-only Better Auth config.
 *
 * `src/auth/auth.ts` is a per-request factory (it needs the D1 binding), which the
 * `auth generate` CLI cannot instantiate. This file mirrors the same plugin set with inert
 * placeholders so the CLI can emit `src/db/auth-schema.ts`:
 *
 *   pnpm exec auth generate --config src/auth/auth-cli-config.ts \
 *     --output src/db/auth-schema.ts --y
 *
 * Keep the plugin list in sync with `createAuth`. Plugins that are only enabled when a
 * secret is present (stripe) are ALWAYS included here — the database shape must not depend
 * on runtime configuration.
 */
import { apiKey } from "@better-auth/api-key";
import { stripe as stripePlugin } from "@better-auth/stripe";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import Stripe from "stripe";

// biome-ignore lint/suspicious/noExplicitAny: no database is touched during schema generation
const placeholderDb = {} as any;

export const auth = betterAuth({
	database: drizzleAdapter(placeholderDb, { provider: "sqlite" }),
	baseURL: "http://localhost:5173",
	emailAndPassword: { enabled: true },
	// `storage: "database"` is what adds the `rateLimit` table.
	rateLimit: { enabled: true, storage: "database" },
	socialProviders: { github: { clientId: "placeholder", clientSecret: "placeholder" } },
	plugins: [
		emailOTP({ sendVerificationOTP: async () => undefined, storeOTP: "encrypted" }),
		apiKey({ defaultPrefix: "wfa_" }),
		stripePlugin({
			stripeClient: new Stripe("sk_test_placeholder"),
			stripeWebhookSecret: "whsec_placeholder",
			createCustomerOnSignUp: true,
		}),
	],
});
