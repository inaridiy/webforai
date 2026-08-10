import { describe, expect, it } from "vitest";

import { creditsFor } from "../billing/credits";
import { createFrontier, discoverLinks, enqueueLinks } from "./links";
import { assertPublicHttpUrl, isForbiddenHost } from "./ssrf";
import { PlatformError } from "./types";

describe("ssrf guard", () => {
	it("accepts public http(s) URLs", () => {
		expect(assertPublicHttpUrl("https://example.com/a?b=c").href).toBe("https://example.com/a?b=c");
		expect(assertPublicHttpUrl("http://93.184.216.34/").href).toBe("http://93.184.216.34/");
	});

	it.each([
		"ftp://example.com/",
		"https://example.com:8080/",
		"https://user:pass@example.com/",
		"https://localhost/",
		"https://foo.localhost/",
		"https://printer.local/",
		"https://metadata.internal/",
		"https://127.0.0.1/",
		"https://10.1.2.3/",
		"https://172.16.0.1/",
		"https://192.168.1.1/",
		"https://169.254.169.254/",
		"https://100.100.1.1/",
		"https://0.0.0.0/",
		"https://[::1]/",
		"https://[fc00::1]/",
		"https://[fe80::1]/",
		"https://[::ffff:10.0.0.1]/",
		"https://2130706433/",
		"https://0x7f000001/",
		"not a url",
	])("rejects %s", (url) => {
		expect(() => assertPublicHttpUrl(url)).toThrow(PlatformError);
	});

	it("treats trailing-dot hostnames like their canonical form", () => {
		expect(isForbiddenHost("localhost.")).toBe(true);
	});
});

describe("credits", () => {
	it("prices engines and options", () => {
		expect(creditsFor({ engine: "fetch", screenshot: false, rehostedImages: 0 })).toBe(1);
		expect(creditsFor({ engine: "proxy-fetch", screenshot: false, rehostedImages: 0 })).toBe(2);
		expect(creditsFor({ engine: "cf-browser", screenshot: true, rehostedImages: 0 })).toBe(6);
		expect(creditsFor({ engine: "proxy-browser", screenshot: true, rehostedImages: 7 })).toBe(8);
	});
});

describe("link discovery", () => {
	const scope = { origin: "https://docs.example.com" };

	it("resolves relative links, strips fragments, dedupes, filters origin", () => {
		const html = `
			<a href="/a">A</a>
			<a href='b#frag'>B</a>
			<a href=c>C</a>
			<a href="/a">dup</a>
			<a href="https://other.com/x">ext</a>
			<a href="mailto:x@y.z">mail</a>
			<a href="javascript:void(0)">js</a>`;
		expect(discoverLinks(html, "https://docs.example.com/dir/page", scope).sort()).toEqual([
			"https://docs.example.com/a",
			"https://docs.example.com/dir/b",
			"https://docs.example.com/dir/c",
		]);
	});

	it("applies include/exclude path patterns; invalid patterns match nothing", () => {
		const html = `<a href="/docs/x">1</a><a href="/blog/y">2</a>`;
		expect(
			discoverLinks(html, "https://docs.example.com/", { ...scope, includePaths: ["^/docs"] }),
		).toEqual(["https://docs.example.com/docs/x"]);
		expect(
			discoverLinks(html, "https://docs.example.com/", { ...scope, excludePaths: ["^/blog"] }),
		).toEqual(["https://docs.example.com/docs/x"]);
		expect(discoverLinks(html, "https://docs.example.com/", { ...scope, includePaths: ["["] })).toEqual([]);
	});

	it("BFS frontier respects depth, page limit and dedup", () => {
		let frontier = createFrontier("https://docs.example.com/");
		frontier = enqueueLinks(frontier, ["https://docs.example.com/a", "https://docs.example.com/b"], 1, {
			maxDepth: 1,
			limit: 3,
		});
		expect(frontier.queue).toHaveLength(3);
		// limit reached: nothing more may enter
		frontier = enqueueLinks(frontier, ["https://docs.example.com/c"], 1, { maxDepth: 1, limit: 3 });
		expect(frontier.seen).toHaveLength(3);
		// depth beyond max is dropped
		frontier = enqueueLinks(frontier, ["https://docs.example.com/d"], 2, { maxDepth: 1, limit: 10 });
		expect(frontier.seen).toHaveLength(3);
	});
});
