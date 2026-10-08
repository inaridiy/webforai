import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createNodejsFnPlugin } from "create-nodejs-fn";
import { defineConfig } from "vite";
import packageJson from "./package.json" with { type: "json" };

// biome-ignore lint/style/noDefaultExport: This is a configuration file
export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		createNodejsFnPlugin({
			// Node-only packages stay in the container image; the Worker sees typed proxies.
			external: ["undici", "playwright"],
			docker: {
				// Only the headless Chromium shell that `chromium.launch({ headless: true })` runs, with its
				// system deps and fonts. Playwright's own image also ships full Chromium, Firefox and WebKit
				// (3.7 GB vs 1.3 GB). Installed before the server bundle is copied so the layer stays cached;
				// the version comes from the `playwright` dependency, which must stay an exact version.
				baseImage: "node:24.21.0-bookworm-slim",
				preInstallCommands: [
					`npx -y playwright@${packageJson.dependencies.playwright} install --with-deps --only-shell chromium && rm -rf /var/lib/apt/lists/* /root/.npm`,
				],
			},
			workerEnvVars: ["PROXY_URL", "PROXY_USERNAME", "PROXY_PASSWORD"],
		}),
		cloudflare(),
	],
});
