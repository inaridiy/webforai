import { TimeoutError } from "@cloudflare/puppeteer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadHtml } from "./cf-puppeteer";

const mocks = vi.hoisted(() => ({
	launch: vi.fn(),
	newPage: vi.fn(),
	close: vi.fn(),
	goto: vi.fn(),
	waitForNetworkIdle: vi.fn(),
	content: vi.fn(),
	pageClose: vi.fn(),
}));

vi.mock("@cloudflare/puppeteer", async (original) => ({
	...(await original<typeof import("@cloudflare/puppeteer")>()),
	default: { launch: mocks.launch },
}));

// The transport is not exercised here; these tests cover the installed adapter's lifecycle.
const binding = { fetch: async () => new Response() };

beforeEach(() => {
	vi.resetAllMocks();
	mocks.launch.mockResolvedValue({ newPage: mocks.newPage, close: mocks.close });
	mocks.newPage.mockResolvedValue({
		goto: mocks.goto,
		waitForNetworkIdle: mocks.waitForNetworkIdle,
		content: mocks.content,
		close: mocks.pageClose,
	});
	mocks.content.mockResolvedValue("<p>Rendered</p>");
});

describe("Cloudflare Puppeteer loader", () => {
	it("waits before taking its snapshot and closes the whole browser session", async () => {
		await expect(loadHtml("https://example.test", binding)).resolves.toBe("<p>Rendered</p>");
		expect(mocks.waitForNetworkIdle.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.content.mock.invocationCallOrder[0],
		);
		expect(mocks.close).toHaveBeenCalledTimes(1);
	});

	it.each(["newPage", "goto", "content"] as const)("closes the browser when %s fails", async (method) => {
		mocks[method].mockRejectedValueOnce(new Error("Failed"));
		await expect(loadHtml("https://example.test", binding)).rejects.toThrow("Failed");
		expect(mocks.close).toHaveBeenCalledTimes(1);
	});

	it("returns current content if the network never settles", async () => {
		mocks.waitForNetworkIdle.mockRejectedValueOnce(new TimeoutError("Timed out"));
		await expect(loadHtml("https://example.test", binding)).resolves.toBe("<p>Rendered</p>");
		expect(mocks.waitForNetworkIdle).toHaveBeenCalledWith({ timeout: 10000 });
		expect(mocks.close).toHaveBeenCalledTimes(1);
	});

	it("preserves non-timeout errors from the network wait", async () => {
		mocks.waitForNetworkIdle.mockRejectedValueOnce(new Error("Disconnected"));
		await expect(loadHtml("https://example.test", binding)).rejects.toThrow("Disconnected");
		expect(mocks.content).not.toHaveBeenCalled();
		expect(mocks.close).toHaveBeenCalledTimes(1);
	});
});
