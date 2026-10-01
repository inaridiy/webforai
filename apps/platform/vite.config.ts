import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createNodejsFnPlugin } from "create-nodejs-fn";
import { defineConfig } from "vite";

// biome-ignore lint/style/noDefaultExport: This is a configuration file
export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		createNodejsFnPlugin({
			// Node-only packages stay in the container image; the Worker sees typed proxies.
			external: ["undici", "playwright"],
			docker: {
				// Playwright's image ships Node.js + Chromium + all system deps.
				// Its version must match the `playwright` dependency version exactly.
				baseImage: "mcr.microsoft.com/playwright:v1.62.1-noble",
			},
			workerEnvVars: ["PROXY_URL", "PROXY_USERNAME", "PROXY_PASSWORD"],
		}),
		cloudflare(),
	],
});
