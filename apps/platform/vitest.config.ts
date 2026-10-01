import { defineConfig } from "vitest/config";

// Deliberately does NOT reuse vite.config.ts: the cloudflare/create-nodejs-fn plugins need
// wrangler config + Docker, which unit tests must not depend on. Tests cover pure logic only.
// biome-ignore lint/style/noDefaultExport: This is a configuration file
export default defineConfig({
	test: {
		// Node 24 + Vitest 1 thread teardown can crash in the CJS lexer after passing tests.
		pool: "forks",
		poolOptions: { forks: { singleFork: true } },
		include: ["src/**/*.test.ts"],
	},
});
