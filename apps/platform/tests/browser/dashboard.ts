/** Browser UI regression with explicit HTTP fixtures; this does not test auth or Cloudflare. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = `${root}.cache/dashboard-review`;
await mkdir(output, { recursive: true });
const server = await createServer({
	configFile: false,
	root,
	plugins: [react(), tailwindcss()],
	server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
	const address = server.httpServer?.address();
	assert(address && typeof address !== "string");
	const origin = `http://127.0.0.1:${address.port}`;
	const page = await browser.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	let issuedKeys = 0;
	let previewRequests = 0;
	page.on("request", (request) => {
		if (request.url().includes("/markdown-preview.tsx")) previewRequests++;
	});
	let jobsFail = true;
	let sessionFails = false;
	let malformedUsage = false;
	const timestamp = "2026-09-06T00:00:00.000Z";
	await page.route("**/api/**", async (route) => {
		const path = new URL(route.request().url()).pathname;
		let status = 200;
		let body: unknown;
		if (path === "/api/auth/get-session") {
			status = sessionFails ? 503 : 200;
			body = sessionFails
				? { message: "Authentication temporarily unavailable" }
				: {
						session: {
							id: "session-1",
							token: "test-token",
							userId: "user-1",
							expiresAt: "2099-01-01T00:00:00Z",
							createdAt: timestamp,
							updatedAt: timestamp,
						},
						user: {
							id: "user-1",
							name: "Reviewer",
							email: `${"long-account-name".repeat(5)}@example.test`,
							emailVerified: true,
							createdAt: timestamp,
							updatedAt: timestamp,
						},
					};
		} else if (path === "/api/dashboard/usage") {
			body = malformedUsage
				? {}
				: {
						monthCredits: 125,
						freeAllowance: 1000,
						billingEnabled: false,
						subscriptionStatus: "none",
						recentEvents: [],
					};
		} else if (path === "/api/dashboard/jobs") {
			status = jobsFail ? 503 : 200;
			body = jobsFail
				? { error: { code: "unavailable", message: "Jobs are temporarily unavailable." } }
				: {
						jobs: [
							{
								id: "01TEST-JOB-LONG-ID-0123456789",
								type: "crawl",
								status: "completed",
								total: 7,
								succeeded: 6,
								failed: 1,
								creditsUsed: 6,
								createdAt: timestamp,
							},
						],
					};
		} else if (path === "/api/auth/api-key/list") {
			body = { apiKeys: [], total: 0, limit: 10, offset: 0 };
		} else if (path === "/api/auth/api-key/create") {
			body = { key: `wfa_${++issuedKeys}_${"test".repeat(40)}` };
		} else {
			throw new Error(`Unexpected fixture request: ${path}`);
		}
		await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
	});
	for (const width of [1440, 390]) {
		jobsFail = true;
		await page.setViewportSize({ width, height: 1100 });
		await page.goto(`${origin}/dashboard`);
		await page.getByText("Jobs could not be loaded", { exact: true }).waitFor();
		assert.equal(await page.getByText("No batch or crawl jobs yet.").count(), 0);
		await page.screenshot({ path: `${output}/error-${width}.png`, fullPage: true });
		jobsFail = false;
		await page.getByRole("button", { name: "Retry", exact: true }).click();
		await page.getByText("completed", { exact: true }).waitFor();
		await page.getByRole("button", { name: "Create your first key" }).click();
		await page.getByLabel("Key name", { exact: true }).fill("production");
		await page.getByRole("button", { name: "Create key", exact: true }).click();
		await page.getByText("Copy this key now", { exact: false }).waitFor();
		await page.evaluate(
			"Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('permission denied')) } })",
		);
		await page.getByRole("button", { name: "Copy", exact: true }).click();
		await page.getByRole("status").filter({ hasText: "Could not copy" }).waitFor();
		await page.getByRole("button", { name: "Create your first key" }).click();
		await page.getByRole("button", { name: "Create key", exact: true }).click();
		await page.waitForFunction(() => !document.body.textContent?.includes("Could not copy."));
		assert.equal(await page.getByRole("button", { name: "Copy", exact: true }).count(), 1);
		await page.evaluate(() => window.scrollTo(0, 0));
		await page.screenshot({ path: `${output}/ready-${width}.png`, fullPage: true });
		const overflow = await page.evaluate(() =>
			Array.from(document.querySelectorAll("body *"))
				.filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
				.map((element) => ({
					tag: element.tagName,
					class: element.className,
					width: element.getBoundingClientRect().width,
				})),
		);
		assert(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
			`dashboard overflow at ${width}px: ${JSON.stringify(overflow)}`,
		);
	}
	malformedUsage = true;
	await page.reload();
	await page.getByText("Usage could not be loaded", { exact: true }).waitFor();
	sessionFails = true;
	await page.reload();
	await page.getByText("Session unavailable", { exact: true }).waitFor();
	assert.equal(new URL(page.url()).pathname, "/dashboard");
	sessionFails = false;
	malformedUsage = false;
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
	assert.equal(previewRequests, 0, "dashboard must not load the Markdown renderer");
	await page.route("**/v1/demo/scrape", (route) =>
		route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({
				url: "https://example.test",
				region: "auto",
				markdown: "# Preview regression\n\nA rendered result.",
				truncated: false,
				metadata: {},
			}),
		}),
	);
	await page.goto(`${origin}/`);
	await page.getByRole("button", { name: "Convert", exact: true }).click();
	await page.getByRole("heading", { name: "Preview regression", exact: true }).waitFor();
	assert.equal(previewRequests, 1, "load the renderer when a result is available");
	await page.route("**/async-fixture", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: '<div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/browser/async-fixture.tsx"></script>',
		}),
	);
	await page.goto(`${origin}/async-fixture`);
	const stateOutput = page.locator("output");
	await page.getByRole("button", { name: "Reload", exact: true }).click();
	await page.getByRole("button", { name: "Resolve newest" }).click();
	assert.match(await stateOutput.innerText(), /newest/);
	await page.getByRole("button", { name: "Resolve older" }).click();
	assert.match(await stateOutput.innerText(), /newest/);
	await page.getByRole("button", { name: "Reload", exact: true }).click();
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await page.getByRole("button", { name: "Resolve newest" }).click();
	assert.match(await stateOutput.innerText(), /saved/);
	await page.getByRole("button", { name: "Reload", exact: true }).click();
	await page.getByRole("button", { name: "Reject newest" }).click();
	assert.match(await stateOutput.innerText(), /error/);
	await page.getByRole("button", { name: "Reload", exact: true }).click();
	await page.getByRole("button", { name: "Toggle", exact: true }).click();
	await page.getByRole("button", { name: "Resolve newest" }).click();
	assert.equal(await stateOutput.count(), 0);
	await page.getByRole("button", { name: "Toggle", exact: true }).click();
	await page.getByRole("button", { name: "Resolve newest" }).click();
	await page.getByRole("button", { name: "Resolve older" }).click();
	assert.match(await stateOutput.innerText(), /newest/);
	assert.deepEqual(errors, []);
	process.stdout.write(
		`Dashboard browser checks passed (desktop/mobile, retry, malformed response, auth outage, clipboard failure). Screenshots: ${output}\n`,
	);
} finally {
	await browser.close();
	await server.close();
}
