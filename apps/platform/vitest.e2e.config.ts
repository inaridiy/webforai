import { defineConfig } from "vitest/config";

/**
 * E2E config, separate from `vitest.config.ts`.
 *
 * The unit config includes only `src/**` and never picks these up; this config includes only
 * `tests/e2e/**` and boots a real Worker via `globalSetup`. Files run sequentially because they
 * share one dev server and one local D1/KV.
 */
// biome-ignore lint/style/noDefaultExport: This is a configuration file
export default defineConfig({
	test: {
		include: ["tests/e2e/**/*.e2e.test.ts"],
		globalSetup: ["tests/e2e/global-setup.ts"],
		fileParallelism: false,
		testTimeout: 90_000,
		hookTimeout: 200_000,
	},
});
