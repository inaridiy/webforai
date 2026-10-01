/**
 * The real Better Auth instance (`createAuth`) against disposable workerd D1 with the checked-in
 * migrations: the 50-keys-per-account cap (`hooks.before` on key creation), the disabled per-key
 * D1 limiter (verification past the old 120/min), and Turnstile failing closed on a production
 * `BASE_URL` with a site key but no secret. Only the email binding is fake.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createAuth } from "../../src/auth/auth";
import { loadConfig } from "../../src/env";
import { MAX_API_KEYS_PER_ACCOUNT } from "../../src/ops/limits";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const runtime = new Miniflare({
	modules: true,
	script: "export default { fetch() { return new Response('ok'); } }",
	d1Databases: ["DB"],
});

const BASE_URL = "http://localhost:5173";
const SECRET = "integration-only-secret-0123456789abcdef0123";

try {
	const binding: D1Database = await runtime.getD1Database("DB");
	const migrationDir = fileURLToPath(new URL("../../drizzle/", import.meta.url));
	for (const file of (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort()) {
		const migration = await readFile(`${migrationDir}/${file}`, "utf8");
		for (const statement of migration.split("--> statement-breakpoint").filter((value) => value.trim())) {
			await binding.prepare(statement).run();
		}
	}

	const sent: unknown[] = [];
	const email = {
		send: (message: unknown) => {
			sent.push(message);
			return Promise.resolve({ messageId: `m${sent.length}` });
		},
	} as unknown as SendEmail;

	const authFor = (vars: Record<string, string>) => {
		const env = { DB: binding, EMAIL: email, BETTER_AUTH_SECRET: SECRET, ...vars } as unknown as Env;
		return createAuth(env, loadConfig(env));
	};
	const post = (
		auth: ReturnType<typeof authFor>,
		base: string,
		path: string,
		body: unknown,
		extra: Record<string, string> = {},
	) =>
		auth.handler(
			new Request(`${base}/api/auth${path}`, {
				method: "POST",
				headers: { "content-type": "application/json", origin: base, ...extra },
				body: JSON.stringify(body),
			}),
		);

	// 1. A signed-in account can hold MAX_API_KEYS_PER_ACCOUNT keys; the next create is refused.
	const auth = authFor({ BASE_URL, AUTH_PASSWORD_LOGIN: "true" });
	const signUp = await post(auth, BASE_URL, "/sign-up/email", {
		email: "keys@example.test",
		password: "integration-password-1",
		name: "Keys",
	});
	assert.equal(signUp.status, 200, await signUp.clone().text());
	const cookie = (signUp.headers.getSetCookie?.() ?? [signUp.headers.get("set-cookie") ?? ""])
		.map((value) => value.split(";")[0])
		.join("; ");

	let firstKey = "";
	for (let index = 0; index < MAX_API_KEYS_PER_ACCOUNT; index += 1) {
		// Distinct client IPs keep Better Auth's per-IP auth limiter out of this test.
		const created = await post(
			auth,
			BASE_URL,
			"/api-key/create",
			{ name: `k${index}` },
			{ cookie, "cf-connecting-ip": `198.51.100.${index + 1}` },
		);
		assert.equal(created.status, 200, await created.clone().text());
		if (index === 0) firstKey = ((await created.json()) as { key: string }).key;
	}
	const refused = await post(
		auth,
		BASE_URL,
		"/api-key/create",
		{ name: "one-too-many" },
		{ cookie, "cf-connecting-ip": "198.51.100.200" },
	);
	assert.equal(refused.status, 403, await refused.clone().text());
	assert.match(await refused.text(), /at most 50 API keys/u);

	// 2. The per-key D1 limiter is off: verification well past the old 120/min keeps passing.
	for (let attempt = 0; attempt < 130; attempt += 1) {
		const result = await auth.api.verifyApiKey({ body: { key: firstKey } });
		assert.equal(result.valid, true, `verification ${attempt + 1}: ${JSON.stringify(result.error)}`);
	}

	// 3. Production BASE_URL with a Turnstile site key but no secret: no code is sent.
	const prodBase = "https://platform.example.com";
	const prod = authFor({ BASE_URL: prodBase, TURNSTILE_SITE_KEY: "0xsite" });
	const before = sent.length;
	const send = await post(
		prod,
		prodBase,
		"/email-otp/send-verification-otp",
		{ email: "prod@example.test", type: "sign-in" },
		{ "cf-connecting-ip": "203.0.113.50" },
	);
	assert.equal(send.status, 500, await send.clone().text());
	assert.equal(sent.length, before, "no sign-in email without the bot check");

	console.log(
		`API key limits passed: ${MAX_API_KEYS_PER_ACCOUNT}-key cap (next create → 403), per-key D1 limiter off (130 verifications), Turnstile fails closed in production without its secret.`,
	);
} finally {
	await runtime.dispose();
}
