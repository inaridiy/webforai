import { defineConfig } from "vitest/config";

// Deliberately does NOT reuse vite.config.ts: the cloudflare/create-nodejs-fn plugins need
// wrangler config + Docker, which unit tests must not depend on. Tests cover pure logic only.
// biome-ignore lint/style/noDefaultExport: This is a configuration file
export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
	},
});
