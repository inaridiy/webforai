/**
 * The real Better Auth instance (`createAuth`) against disposable workerd D1 with the checked-in
 * migrations: email-code sign-in end to end, the D1-backed rate limiter, hashed code storage and
 * the disabled password flow. Only the email binding is fake — it records what would be sent.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createAuth } from "../../src/auth/auth";
import { SIGN_IN_SENDER } from "../../src/auth/sign-in-email";
import * as schema from "../../src/db/schema";
import { loadConfig } from "../../src/env";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const runtime = new Miniflare({
	modules: true,
	script: "export default { fetch() { return new Response('ok'); } }",
	d1Databases: ["DB"],
});

const BASE_URL = "http://localhost:5173";

try {
	const binding: D1Database = await runtime.getD1Database("DB");
	const migrationDir = fileURLToPath(new URL("../../drizzle/", import.meta.url));
	for (const file of (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort()) {
		const migration = await readFile(`${migrationDir}/${file}`, "utf8");
		for (const statement of migration.split("--> statement-breakpoint").filter((value) => value.trim())) {
			await binding.prepare(statement).run();
		}
	}

	const sent: { from: unknown; to: unknown; subject: string; text?: string }[] = [];
	const email = {
		send: (message: { from: unknown; to: unknown; subject: string; text?: string }) => {
			sent.push(message);
			return Promise.resolve({ messageId: `m${sent.length}` });
		},
	} as unknown as SendEmail;
	const env = {
		DB: binding,
		EMAIL: email,
		BASE_URL,
		BETTER_AUTH_SECRET: "integration-only-secret-0123456789abcdef0123",
	} as unknown as Env;
	const auth = createAuth(env, loadConfig(env));

	const call = (path: string, body: unknown, ip = "198.51.100.7") =>
		auth.handler(
			new Request(`${BASE_URL}/api/auth${path}`, {
				method: "POST",
				headers: { "content-type": "application/json", origin: BASE_URL, "cf-connecting-ip": ip },
				body: JSON.stringify(body),
			}),
		);
	const lastCode = (): string => {
		const match = /\b(\d{6})\b/.exec(sent.at(-1)?.subject ?? "");
		assert(match?.[1], "a 6-digit code in the subject");
		return match[1];
	};

	// 1. Request a code: one email, from the sign-in sender, to the address.
	const address = "new-user@example.test";
	const send = await call("/email-otp/send-verification-otp", { email: address, type: "sign-in" });
	assert.equal(send.status, 200, await send.clone().text());
	assert.equal(sent.length, 1);
	assert.deepEqual(sent[0]?.from, SIGN_IN_SENDER);
	assert.equal(sent[0]?.to, address);
	const code = lastCode();

	// 2. The code is stored encrypted, never as sent.
	const stored = await drizzle(binding, { schema }).select().from(schema.verification);
	assert.equal(stored.length, 1);
	assert(!stored[0]?.value.includes(code), "stored OTP must not contain the plain code");

	// 2b. Asking again within the validity window re-sends the same code, so an older email
	//     still works (a rotated code silently broke the first email a user opened).
	const resend = await call("/email-otp/send-verification-otp", { email: address, type: "sign-in" });
	assert.equal(resend.status, 200, await resend.clone().text());
	assert.equal(sent.length, 2);
	assert.equal(lastCode(), code, "resend within the window reuses the code");

	// 3. A wrong code is rejected; the right one signs in and creates the account.
	const wrong = await call("/sign-in/email-otp", { email: address, otp: code === "000000" ? "111111" : "000000" });
	assert.equal(wrong.status, 400, await wrong.clone().text());
	const signIn = await call("/sign-in/email-otp", { email: address, otp: code });
	assert.equal(signIn.status, 200, await signIn.clone().text());
	assert.match(signIn.headers.get("set-cookie") ?? "", /session_token=/);
	const users = await drizzle(binding, { schema }).select().from(schema.user).where(eq(schema.user.email, address));
	assert.equal(users.length, 1);

	// 4. A used code does not work twice.
	const replay = await call("/sign-in/email-otp", { email: address, otp: code });
	assert.notEqual(replay.status, 200);

	// 5. Sending is rate limited per client IP, persisted in D1's rate_limit table.
	const ip = "203.0.113.50";
	const statuses: number[] = [];
	for (let attempt = 0; attempt < 4; attempt += 1) {
		statuses.push(
			(await call("/email-otp/send-verification-otp", { email: "limit@example.test", type: "sign-in" }, ip)).status,
		);
	}
	assert.deepEqual(statuses, [200, 200, 200, 429]);
	const limits = await drizzle(binding, { schema }).select().from(schema.rateLimit);
	assert(limits.length > 0, "rate limit rows persisted in D1");

	// 6. Passwords are off unless AUTH_PASSWORD_LOGIN=true.
	const password = await call("/sign-up/email", { email: "pw@example.test", password: "Passw0rd!long", name: "x" });
	assert.notEqual(password.status, 200);

	// 7. With Turnstile configured, sending a code without a widget token is refused before
	//    any email goes out (siteverify itself is exercised against production, not here).
	const guarded = createAuth(
		{
			...env,
			TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
			TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
		} as unknown as Env,
		loadConfig({
			...env,
			TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
			TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
		} as unknown as Env),
	);
	const before = sent.length;
	const noToken = await guarded.handler(
		new Request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: BASE_URL, "cf-connecting-ip": "192.0.2.9" },
			body: JSON.stringify({ email: "bot@example.test", type: "sign-in" }),
		}),
	);
	assert.equal(noToken.status, 400, await noToken.clone().text());
	assert.equal(sent.length, before, "no email without a Turnstile token");

	console.log(
		"Email OTP sign-in passed: code email, encrypted storage, resend reuses the code, wrong/replayed code rejected, account created, D1 rate limit (4th send → 429), passwords disabled, Turnstile required when configured.",
	);
} finally {
	await runtime.dispose();
}
