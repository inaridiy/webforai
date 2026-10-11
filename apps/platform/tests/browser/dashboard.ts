/** Browser UI regression with explicit HTTP fixtures; this does not test auth or Cloudflare. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

/**
 * Sign-in endpoints: the signed-out session, which methods exist, sending a code, and code
 * sign-in (only `123456` works). `signedIn` tells the caller the fixture session is now live.
 */
const signInFixture = (
	path: string,
	requestBody: () => unknown,
	state: { githubEnabled: boolean; signedOut: boolean },
): { status: number; body: unknown; signedIn?: boolean } | undefined => {
	if (path === "/api/auth/get-session" && state.signedOut) {
		return { status: 200, body: null };
	}
	if (path === "/api/auth-methods") {
		return { status: 200, body: { github: state.githubEnabled, password: false } };
	}
	if (path === "/api/auth/email-otp/send-verification-otp") {
		return { status: 200, body: { success: true } };
	}
	if (path === "/api/auth/sign-in/email-otp") {
		const { otp } = requestBody() as { otp: string };
		return otp === "123456"
			? { status: 200, body: { token: "session-token", user: { id: "user-1" } }, signedIn: true }
			: { status: 400, body: { code: "INVALID_OTP", message: "Invalid OTP" } };
	}
	return undefined;
};

/** Key creation: a fresh key, or the per-account limit's 403 (src/auth/guards.ts). */
const createKeyFixture = (limitReached: boolean, serial: number): { status: number; body: unknown } =>
	limitReached
		? {
				status: 403,
				body: {
					code: "API_KEY_LIMIT_REACHED",
					message: "An account can hold at most 50 API keys. Revoke an unused key to create a new one.",
				},
			}
		: { status: 200, body: { key: `wfa_${serial}_${"test".repeat(40)}` } };

/** Newest first: 5 scrapes, then one 30-page crawl, then 10 older scrapes — 45 ledger rows. */
const usageFixture = [
	...Array.from({ length: 5 }, (_, index) => ({ id: `s${index}`, jobId: null, operation: "fetch" })),
	...Array.from({ length: 30 }, (_, index) => ({
		id: `p${index}`,
		jobId: "job_crawl",
		operation: index % 3 === 0 ? "browser" : "fetch",
	})),
	...Array.from({ length: 10 }, (_, index) => ({ id: `o${index}`, jobId: null, operation: "browser" })),
].map((event, index) => ({
	...event,
	credits: event.operation === "browser" ? 2 : 1,
	createdAt: new Date(Date.UTC(2026, 8, 24, 12, 0, 45 - index)).toISOString(),
}));

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
	let signedOut = false;
	let githubEnabled = false;
	let malformedUsage = false;
	let keyLimitReached = false;
	const timestamp = "2026-09-06T00:00:00.000Z";
	await page.route("**/api/**", async (route) => {
		const path = new URL(route.request().url()).pathname;
		let status = 200;
		let body: unknown;
		const signIn = signInFixture(path, route.request().postDataJSON.bind(route.request()), {
			githubEnabled,
			signedOut,
		});
		if (signIn !== undefined) {
			signedOut = signedOut && signIn.signedIn !== true;
			await route.fulfill({
				status: signIn.status,
				contentType: "application/json",
				body: JSON.stringify(signIn.body),
			});
			return;
		}
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
						recentEvents: usageFixture,
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
			({ status, body } = createKeyFixture(keyLimitReached, ++issuedKeys));
		} else {
			throw new Error(`Unexpected fixture request: ${path}`);
		}
		await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
	});
	for (const width of [1440, 390]) {
		jobsFail = true;
		await page.setViewportSize({ width, height: 1100 });
		await page.goto(`${origin}/dashboard`);
		// The previous pass saved its jobs on this device, and a failed load would show that copy
		// ("Saved … — offline") instead of the error; start each pass from an empty cache.
		await page.evaluate(() => localStorage.clear());
		await page.reload();
		await page.getByText("Jobs could not be loaded", { exact: true }).waitFor();
		assert.equal(await page.getByText("No batch or crawl jobs yet.").count(), 0);
		await page.screenshot({ path: `${output}/error-${width}.png`, fullPage: true });
		jobsFail = false;
		await page.getByRole("button", { name: "Retry", exact: true }).click();
		await page.getByText("completed", { exact: true }).waitFor();
		// 45 ledger rows → 16 rows once the crawl's pages are grouped; 8 shown until expanded.
		await page.getByText("Job, 30 pages", { exact: true }).waitFor();
		await page.getByText("8 more", { exact: true }).waitFor();
		await page.getByRole("button", { name: "Show more", exact: true }).click();
		await page.getByText("Showing the latest 50 entries.", { exact: true }).waitFor();
		await page.getByRole("button", { name: "Show less", exact: true }).click();
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
	// The per-account key limit answers 403 with a message; the form shows it as is.
	keyLimitReached = true;
	await page.getByRole("button", { name: "Create your first key" }).click();
	await page.getByRole("button", { name: "Create key", exact: true }).click();
	await page.getByText("An account can hold at most 50 API keys.", { exact: false }).waitFor();
	keyLimitReached = false;
	malformedUsage = true;
	await page.reload();
	await page.getByText("Usage could not be loaded", { exact: true }).waitFor();
	sessionFails = true;
	// Without a saved session the outage must surface (with one, the app opens from the cache).
	await page.evaluate(() => localStorage.clear());
	await page.reload();
	await page.getByText("Session unavailable", { exact: true }).waitFor();
	assert.equal(new URL(page.url()).pathname, "/dashboard");
	sessionFails = false;
	malformedUsage = false;
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
	assert.equal(previewRequests, 0, "dashboard must not load the Markdown renderer");
	// Email-code sign-in: no GitHub button without OAuth credentials, wrong code rejected,
	// right code signs in and lands on the dashboard.
	signedOut = true;
	await page.setViewportSize({ width: 1440, height: 1100 });
	await page.goto(`${origin}/login`);
	await page.getByRole("heading", { name: "Sign in", level: 1 }).waitFor();
	assert.equal(await page.title(), "Sign in — webforai platform");
	// Agreeing to the Terms happens here, so both documents must be linked before continuing.
	await page.getByRole("link", { name: "Terms of Service", exact: true }).waitFor();
	await page.getByRole("link", { name: "Privacy Policy", exact: true }).waitFor();
	await page.getByLabel("Email", { exact: true }).fill("new-user@example.test");
	assert.equal(await page.getByRole("button", { name: "Continue with GitHub" }).count(), 0);
	await page.getByRole("button", { name: "Email me a code", exact: true }).click();
	await page.getByText("Check your email", { exact: true }).waitFor();
	await page.getByLabel("Code", { exact: true }).fill("000000");
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await page.getByText("That code is not right. Check the email, or send a new code.", { exact: true }).waitFor();
	await page.screenshot({ path: `${output}/signin-code-1440.png`, fullPage: true });
	await page.getByLabel("Code", { exact: true }).fill("123456");
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
	signedOut = true;
	githubEnabled = true;
	await page.goto(`${origin}/signup`);
	await page.getByRole("button", { name: "Continue with GitHub" }).waitFor();
	await page.screenshot({ path: `${output}/signup-1440.png`, fullPage: true });
	signedOut = false;

	// Legal pages render as routes of the SPA.
	for (const [path, heading] of [
		["/terms", "Terms of Service"],
		["/privacy", "Privacy Policy"],
		["/commerce", "特定商取引法に基づく表記"],
	] as const) {
		await page.goto(`${origin}${path}`);
		await page.getByRole("heading", { name: heading, level: 1 }).waitFor();
		assert.equal(await page.title(), `${heading} — webforai platform`);
		await page.screenshot({ path: `${output}/legal${path.replace("/", "-")}.png`, fullPage: true });
	}
	await page.goto(`${origin}/no-such-page`);
	await page.getByRole("heading", { name: "No page at /no-such-page", level: 1 }).waitFor();
	assert.equal(await page.title(), "Page not found — webforai platform");
	await page.getByRole("link", { name: "Open the dashboard", exact: true }).waitFor();
	await page.keyboard.press("Tab");
	assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to content");
	await page.keyboard.press("Enter");
	assert.equal(await page.evaluate(() => document.activeElement?.id), "main");

	// PWA share target: the first http(s) URL in `text` prefills the playground when signed in…
	const shared = "https://example.test/shared?a=1";
	await page.goto(`${origin}/share?title=Hi&text=${encodeURIComponent(`Look at this: ${shared}.`)}`);
	await page.waitForURL((url) => url.pathname === "/playground");
	assert.equal(await page.getByLabel("URL", { exact: true }).inputValue(), shared);
	assert.equal(await page.title(), "Playground — webforai platform");
	// …and the proxy engines are flagged as paid-only for an account without a subscription.
	await page.getByLabel("Engine", { exact: true }).selectOption("proxy-fetch");
	await page.getByText("Proxy engines are on paid plans", { exact: true }).waitFor();
	await page.getByLabel("Engine", { exact: true }).selectOption("fetch");
	assert.equal(await page.getByText("Proxy engines are on paid plans", { exact: true }).count(), 0);
	// …and the keyless landing demo when signed out. A signed-out device has no saved session
	// (sign-out and an expired session clear it), so drop the one saved above.
	signedOut = true;
	await page.evaluate(() => localStorage.clear());
	await page.goto(`${origin}/share?url=${encodeURIComponent(shared)}`);
	await page.waitForURL((url) => url.pathname === "/");
	await page.waitForFunction(
		(expected) => (document.getElementById("demo-url") as HTMLInputElement | null)?.value === expected,
		shared,
	);
	signedOut = false;

	await page.route("**/v1/demo/scrape", (route) =>
		route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({
				url: "https://example.test",
				region: "auto",
				engine: "browser",
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
	await page.getByText("auto → browser", { exact: true }).waitFor();
	// The demo has no region choice (Japan egress is paid-only) and ends with the same request
	// for the user's own code.
	assert.equal(await page.getByLabel("Egress region").count(), 0);
	await page.getByRole("heading", { name: "Same page, from your code", exact: true }).waitFor();
	await page.getByText("npx webforai-cli https://example.test", { exact: true }).waitFor();
	await page.getByRole("tab", { name: "CLI", exact: true }).first().click();
	assert.equal(await page.title(), "webforai platform — any web page as clean Markdown");
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
