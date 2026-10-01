import { APIError } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";

import { MAX_API_KEYS_PER_ACCOUNT } from "../ops/limits";
import {
	type AuthGuardDeps,
	CREATE_API_KEY_PATH,
	SEND_SIGN_IN_CODE_PATH,
	guardAuthRequest,
	isProductionBaseUrl,
	turnstileSecretMissing,
} from "./guards";

const PROD = "https://platform.webforai.dev";

const deps = (
	overrides: Partial<Omit<AuthGuardDeps, "config">> & { config?: Partial<AuthGuardDeps["config"]> } = {},
) => {
	const log = { error: vi.fn() };
	const value: AuthGuardDeps = {
		sessionUserId: () => Promise.resolve("user_1"),
		countApiKeys: () => Promise.resolve(0),
		log,
		...overrides,
		config: { BASE_URL: PROD, TURNSTILE_SITE_KEY: "0xsite", TURNSTILE_SECRET_KEY: "0xsecret", ...overrides.config },
	};
	return { value, log };
};

describe("isProductionBaseUrl", () => {
	it("is true only for public https hosts", () => {
		expect(isProductionBaseUrl(PROD)).toBe(true);
		expect(isProductionBaseUrl("http://localhost:5173")).toBe(false);
		expect(isProductionBaseUrl("https://localhost:8787")).toBe(false);
		expect(isProductionBaseUrl("https://127.0.0.1")).toBe(false);
		expect(isProductionBaseUrl("https://app.localhost")).toBe(false);
		expect(isProductionBaseUrl("http://staging.example.com")).toBe(false);
	});
});

describe("Turnstile fail-closed", () => {
	it("flags a production site key without its secret", () => {
		expect(turnstileSecretMissing({ BASE_URL: PROD, TURNSTILE_SITE_KEY: "0xsite" })).toBe(true);
		expect(
			turnstileSecretMissing({ BASE_URL: PROD, TURNSTILE_SITE_KEY: "0xsite", TURNSTILE_SECRET_KEY: "0xsecret" }),
		).toBe(false);
		// Local dev with the checked-in site key and no secret keeps working without captcha.
		expect(turnstileSecretMissing({ BASE_URL: "http://localhost:5173", TURNSTILE_SITE_KEY: "0xsite" })).toBe(false);
		expect(turnstileSecretMissing({ BASE_URL: PROD })).toBe(false);
	});

	it("refuses to send a sign-in code with a loud log instead of skipping the captcha", async () => {
		const { value, log } = deps({ config: { TURNSTILE_SECRET_KEY: undefined } });
		const error = await guardAuthRequest(SEND_SIGN_IN_CODE_PATH, value).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(APIError);
		expect((error as APIError).statusCode).toBe(500);
		expect(log.error).toHaveBeenCalledWith("turnstile_secret_missing", expect.any(Object));
	});

	it("lets the send through when configured, and other paths regardless", async () => {
		await expect(guardAuthRequest(SEND_SIGN_IN_CODE_PATH, deps().value)).resolves.toBeUndefined();
		const misconfigured = deps({ config: { TURNSTILE_SECRET_KEY: undefined } }).value;
		await expect(guardAuthRequest("/sign-in/email-otp", misconfigured)).resolves.toBeUndefined();
	});
});

describe("API key cap", () => {
	it("allows creating keys below the cap", async () => {
		const { value } = deps({ countApiKeys: () => Promise.resolve(MAX_API_KEYS_PER_ACCOUNT - 1) });
		await expect(guardAuthRequest(CREATE_API_KEY_PATH, value)).resolves.toBeUndefined();
	});

	it("refuses the 51st key with a message naming the cap", async () => {
		const countApiKeys = vi.fn(() => Promise.resolve(MAX_API_KEYS_PER_ACCOUNT));
		const { value } = deps({ countApiKeys });
		const error = await guardAuthRequest(CREATE_API_KEY_PATH, value).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(APIError);
		expect((error as APIError).statusCode).toBe(403);
		expect((error as APIError).message).toContain("at most 50 API keys");
		expect(countApiKeys).toHaveBeenCalledWith("user_1");
	});

	it("leaves an unauthenticated create to the plugin's own 401", async () => {
		const countApiKeys = vi.fn(() => Promise.resolve(999));
		const { value } = deps({ sessionUserId: () => Promise.resolve(undefined), countApiKeys });
		await expect(guardAuthRequest(CREATE_API_KEY_PATH, value)).resolves.toBeUndefined();
		expect(countApiKeys).not.toHaveBeenCalled();
	});
});
