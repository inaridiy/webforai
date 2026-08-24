import { afterEach, describe, expect, it, vi } from "vitest";
import { workersFetchEngine } from "./workers-fetch";

const OWN_LANDING = "<html><head><title>platform</title></head><body><main>own landing content</main></body></html>";

const htmlResponse = (body: string) =>
	new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

describe("workersFetchEngine self-serving", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("serves the deployment's own pages from the assets binding, never fetching its own zone", async () => {
		// A real fetch of our own zone loops and is answered 522 by Cloudflare; reaching the
		// global fetch at all is the regression this test pins.
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve(new Response("loop", { status: 522 }))),
		);
		const assets = { fetch: vi.fn((_input: string) => Promise.resolve(htmlResponse(OWN_LANDING))) };

		const page = await workersFetchEngine(
			{ url: "https://platform.webforai.dev/", screenshot: false },
			{ self: { host: "platform.webforai.dev", assets } },
		);

		expect(page.html).toContain("own landing content");
		expect(page.status).toBe(200);
		expect(assets.fetch).toHaveBeenCalledWith("https://platform.webforai.dev/");
		expect(fetch).not.toHaveBeenCalled();
	});

	it("fetches every other host over the network", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve(htmlResponse("<html><body>elsewhere</body></html>"))),
		);
		const assets = { fetch: vi.fn((_input: string) => Promise.reject(new Error("assets must not serve other hosts"))) };

		const page = await workersFetchEngine(
			{ url: "https://example.com/article", screenshot: false },
			{ self: { host: "platform.webforai.dev", assets } },
		);

		expect(page.html).toContain("elsewhere");
		expect(assets.fetch).not.toHaveBeenCalled();
	});
});
