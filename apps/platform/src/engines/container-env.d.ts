/**
 * Proxy settings are wrangler *secrets*, so `wrangler types` cannot see them and they are
 * absent from the generated `Env`. The create-nodejs-fn Durable Object forwards them into the
 * container (`workerEnvVars` in vite.config.ts) and `env.ts` validates them at boot, so both
 * shapes of the binding type need to know about them.
 */

interface Env {
	// biome-ignore lint/style/useNamingConvention: environment variable name
	PROXY_URL: string;
	// biome-ignore lint/style/useNamingConvention: environment variable name
	PROXY_USERNAME: string;
	// biome-ignore lint/style/useNamingConvention: environment variable name
	PROXY_PASSWORD: string;
}

// biome-ignore lint/style/noNamespace: matches Cloudflare's own generated declaration
declare namespace Cloudflare {
	interface Env {
		// biome-ignore lint/style/useNamingConvention: environment variable name
		PROXY_URL: string;
		// biome-ignore lint/style/useNamingConvention: environment variable name
		PROXY_USERNAME: string;
		// biome-ignore lint/style/useNamingConvention: environment variable name
		PROXY_PASSWORD: string;
	}
}
