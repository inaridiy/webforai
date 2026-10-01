import { describe, expect, it } from "vitest";

import { MAX_REDIRECTS, fetchFollowingRedirects } from "./redirects";
import { PlatformError } from "./types";

const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

/** A fake single-hop fetch answering from a route table, recording every URL it was asked for. */
const routes = (table: Record<string, () => Response>) => {
	const requested: string[] = [];
	const fetchOne = (url: string) => {
		requested.push(url);
		const route = table[url];
		return Promise.resolve(route ? route() : new Response("not found", { status: 404 }));
	};
	return { fetchOne, requested };
};

describe("fetchFollowingRedirects", () => {
	it("follows public hops (relative locations included) and reports the landing URL", async () => {
		const { fetchOne, requested } = routes({
			"https://example.com/a": () => redirect("https://www.example.com/b", 301),
			"https://www.example.com/b": () => redirect("/c?x=1", 307),
			"https://www.example.com/c?x=1": () => new Response("done"),
		});

		const { response, url } = await fetchFollowingRedirects(fetchOne, "https://example.com/a");

		expect(await response.text()).toBe("done");
		expect(url).toBe("https://www.example.com/c?x=1");
		expect(requested).toHaveLength(3);
	});

	it.each([
		"http://127.0.0.1/admin",
		"http://169.254.169.254/latest/meta-data/",
		"http://[::1]/",
		"http://localhost/",
		"https://example.com:8443/",
		"file:///etc/passwd",
	])("refuses a hop to %s before requesting it", async (location) => {
		const { fetchOne, requested } = routes({ "https://example.com/": () => redirect(location) });

		const failure = fetchFollowingRedirects(fetchOne, "https://example.com/");

		await expect(failure).rejects.toBeInstanceOf(PlatformError);
		await expect(failure).rejects.toMatchObject({ code: "invalid_url", status: 400 });
		expect(requested).toEqual(["https://example.com/"]);
	});

	it("refuses a private start URL without requesting anything", async () => {
		const { fetchOne, requested } = routes({});
		await expect(fetchFollowingRedirects(fetchOne, "http://10.0.0.1/")).rejects.toMatchObject({ code: "invalid_url" });
		expect(requested).toEqual([]);
	});

	it("gives up after the hop limit", async () => {
		let hop = 0;
		const fetchOne = () => {
			hop += 1;
			return Promise.resolve(redirect(`https://example.com/${hop}`));
		};

		await expect(fetchFollowingRedirects(fetchOne, "https://example.com/0")).rejects.toMatchObject({
			code: "fetch_failed",
			status: 502,
		});
		expect(hop).toBe(MAX_REDIRECTS + 1);
	});

	it("returns a 3xx without a Location as the final response", async () => {
		const { fetchOne } = routes({ "https://example.com/": () => new Response(null, { status: 302 }) });
		const { response } = await fetchFollowingRedirects(fetchOne, "https://example.com/");
		expect(response.status).toBe(302);
	});

	it("uses the injected URL check on every hop", async () => {
		const checked: string[] = [];
		const { fetchOne } = routes({
			"https://example.com/": () => redirect("https://other.example/"),
			"https://other.example/": () => new Response("ok"),
		});
		await fetchFollowingRedirects(fetchOne, "https://example.com/", {
			assertUrl: (url) => {
				checked.push(url);
				return url;
			},
		});
		expect(checked).toEqual(["https://example.com/", "https://other.example/"]);
	});
});
