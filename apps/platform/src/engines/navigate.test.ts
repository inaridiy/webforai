import { describe, expect, it } from "vitest";
import { type NavigablePage, navigate } from "./navigate";

const timeoutError = (): Error => Object.assign(new Error("Timeout exceeded"), { name: "TimeoutError" });

const fakePage = (options: { idle?: () => Promise<void>; gotoMs?: number; clock: { t: number } }) => {
	const calls: string[] = [];
	const page: NavigablePage<string> = {
		goto: (url, { waitUntil, timeout }) => {
			calls.push(`goto ${url} ${waitUntil} ${timeout}`);
			options.clock.t += options.gotoMs ?? 0;
			return Promise.resolve("response");
		},
		waitForLoadState: (state, { timeout }) => {
			calls.push(`wait ${state} ${timeout}`);
			return options.idle ? options.idle() : Promise.resolve();
		},
	};
	return { page, calls };
};

describe("navigate", () => {
	it("navigates once and waits for network idle within the remaining budget", async () => {
		const clock = { t: 0 };
		const { page, calls } = fakePage({ clock, gotoMs: 4_000 });

		const response = await navigate(page, "https://example.com/", 30_000, () => clock.t);

		expect(response).toBe("response");
		expect(calls).toEqual(["goto https://example.com/ domcontentloaded 30000", "wait networkidle 26000"]);
	});

	it("keeps the loaded page when it never goes idle — no second navigation", async () => {
		const clock = { t: 0 };
		const { page, calls } = fakePage({ clock, idle: () => Promise.reject(timeoutError()) });

		await expect(navigate(page, "https://example.com/", 30_000, () => clock.t)).resolves.toBe("response");
		expect(calls.filter((call) => call.startsWith("goto"))).toHaveLength(1);
	});

	it("skips the idle wait when the load used the whole budget", async () => {
		const clock = { t: 0 };
		const { page, calls } = fakePage({ clock, gotoMs: 30_000 });

		await navigate(page, "https://example.com/", 30_000, () => clock.t);

		expect(calls).toEqual(["goto https://example.com/ domcontentloaded 30000"]);
	});

	it("propagates failures other than the idle timeout", async () => {
		const clock = { t: 0 };
		const { page } = fakePage({ clock, idle: () => Promise.reject(new Error("Target closed")) });

		await expect(navigate(page, "https://example.com/", 30_000, () => clock.t)).rejects.toThrow("Target closed");
	});
});
