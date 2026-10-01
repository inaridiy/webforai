import { describe, expect, it } from "vitest";

import { MAX_CODE_EMAILS_PER_RECIPIENT, RECIPIENT_WINDOW_SECONDS, takeRecipientBudget } from "./recipient-limit";

const fakeKv = () => {
	const store = new Map<string, string>();
	return {
		store,
		get: (key: string) => Promise.resolve(store.get(key) ?? null),
		put: (key: string, value: string) => {
			store.set(key, value);
			return Promise.resolve();
		},
	};
};

describe("takeRecipientBudget", () => {
	it("allows a few code emails per address per hour, case-insensitively, then refuses", async () => {
		const kv = fakeKv();
		const now = new Date("2026-10-01T00:00:00Z");
		const results: boolean[] = [];
		for (let i = 0; i < MAX_CODE_EMAILS_PER_RECIPIENT + 1; i += 1) {
			results.push(await takeRecipientBudget(kv, i % 2 ? "User@Example.test" : "user@example.test", now));
		}
		expect(results).toEqual([...Array(MAX_CODE_EMAILS_PER_RECIPIENT).fill(true), false]);
		expect(await takeRecipientBudget(kv, "other@example.test", now)).toBe(true);
		expect([...kv.store.keys()].some((key) => key.includes("example"))).toBe(false);

		const later = new Date(now.getTime() + RECIPIENT_WINDOW_SECONDS * 1000 + 1000);
		expect(await takeRecipientBudget(kv, "user@example.test", later)).toBe(true);
	});

	it("never blocks when KV is absent or failing", async () => {
		expect(await takeRecipientBudget(undefined, "a@example.test")).toBe(true);
		const broken = { get: () => Promise.reject(new Error("down")), put: () => Promise.resolve() };
		expect(await takeRecipientBudget(broken, "a@example.test")).toBe(true);
	});
});
