import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BASE_URL } from "./config";

/**
 * One SPA smoke test against the real dev server, driven with the `playwright` library that ships
 * as a platform dependency (its browsers are already installed). Kept minimal and non-flaky: the
 * dashboard SPA was browser-verified separately, so this only proves the app boots and the
 * anonymous auth boundary works. If a browser cannot launch in this environment the test skips
 * rather than failing the required API suite.
 */

let browser: Browser | undefined;
let launchError: unknown;

beforeAll(async () => {
	try {
		const { chromium } = await import("playwright");
		browser = await chromium.launch({ headless: true });
	} catch (error) {
		launchError = error;
	}
});

afterAll(async () => {
	await browser?.close();
});

describe("dashboard SPA", () => {
	it("loads the app and redirects an anonymous /dashboard visit to /login", async (ctx) => {
		if (!browser) {
			// eslint-disable-next-line no-console
			console.warn(`Skipping SPA smoke test — chromium unavailable: ${String(launchError)}`);
			ctx.skip();
			return;
		}

		const page = await browser.newPage();
		try {
			await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30_000 });
			expect(await page.title()).toContain("webforai");
			const root = await page.locator("#root").innerHTML();
			expect(root.length).toBeGreaterThan(0);

			await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle", timeout: 30_000 });
			expect(page.url()).toContain("/login");
		} finally {
			await page.close();
		}
	});
});
