/// <reference types="vitest" />
import { configDefaults, defineConfig } from "vitest/config";

// biome-ignore lint/style/noDefaultExport: This is a configuration file
export default defineConfig({
	assetsInclude: ["**/*.html", "**/*.md"],
	test: {
		// The platform e2e suite needs a live dev server (real D1/KV/Docker); it runs only via
		// `pnpm --filter platform test:e2e`, never from the repo-wide unit sweep.
		exclude: [...configDefaults.exclude, "**/tests/e2e/**"],
	},
});
