import { describe, expect, it } from "vitest";

import { creditsFor } from "../billing/credits";
import {
	MAX_CRAWL_URL_LENGTH,
	MAX_PATH_PATTERN_LENGTH,
	createFrontier,
	discoverLinks,
	enqueueLinks,
	pathPatternProblem,
} from "./links";
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
		"https://198.18.0.1/",
		"https://198.19.255.255/",
		"https://100.64.0.1/",
		"https://0.1.2.3/",
		"https://224.0.0.1/",
		"https://240.0.0.1/",
		"https://255.255.255.255/",
		"https://192.0.2.1/",
		"https://[::]/",
		"https://[::127.0.0.1]/",
		"https://[::7f00:1]/",
		"https://[::8.8.8.8]/",
		"https://[64:ff9b::127.0.0.1]/",
		"https://[64:ff9b::a9fe:a9fe]/",
		"https://[64:ff9b:1::1]/",
		"https://[2002:7f00:1::]/",
		"https://[2002:a9fe:a9fe::1]/",
		"https://[2002:c0a8:101::1]/",
		"https://[2001::1]/",
		"https://[2001:db8::1]/",
		"https://[fec0::1]/",
		"https://[febf::1]/",
		"https://[ff02::1]/",
		"https://[::ffff:127.0.0.1]/",
		"https://[::ffff:a9fe:a9fe]/",
		"https://router.home.arpa/",
		"https://2130706433/",
		"https://0x7f000001/",
		"not a url",
	])("rejects %s", (url) => {
		expect(() => assertPublicHttpUrl(url)).toThrow(PlatformError);
	});

	it.each([
		"https://[2606:4700::1111]/",
		"https://[64:ff9b::808:808]/",
		"https://[2002:808:808::1]/",
		"https://[::ffff:8.8.8.8]/",
		"https://198.20.0.1/",
		"https://100.128.0.1/",
		"https://223.255.255.255/",
	])("accepts public address %s", (url) => {
		expect(() => assertPublicHttpUrl(url)).not.toThrow();
	});

	it("rejects malformed IPv6 literals outright", () => {
		expect(isForbiddenHost("1:2:3:4:5:6:7:8:9")).toBe(true);
		expect(isForbiddenHost("1::2::3")).toBe(true);
		expect(isForbiddenHost("gggg::1")).toBe(true);
	});

	it("treats trailing-dot hostnames like their canonical form", () => {
		expect(isForbiddenHost("localhost.")).toBe(true);
	});
});

describe("path pattern screen", () => {
	it.each([
		"^/docs",
		"^/docs/",
		"\\.html$",
		"^/(en|ja)/blog/.+",
		"^/blog/\\d+/.*",
		"^/(?:v1|v2)/api",
		"^(?:/(en|ja))?/docs/",
		"^/a{2,5}b",
		"^/[a-z]+/[0-9]+$",
		"^/(?<lang>[a-z]{2})/",
		"^/x(?=y)",
	])("accepts %s", (pattern) => {
		expect(pathPatternProblem(pattern)).toBeUndefined();
	});

	it.each([
		["(a+)+$", /nested quantifiers/],
		["^/(a*)*b", /nested quantifiers/],
		["^/(a|aa)+$", /nested quantifiers/],
		["^/((a+)b)+", /nested quantifiers/],
		["^/(?:\\w+\\s?)*$", /nested quantifiers/],
		["^/((a|b)c)*", /nested quantifiers/],
		["^/(a)\\1", /backreferences/],
		["^/(?<x>a)\\k<x>", /backreferences/],
		["^/a{1,5000}", /repeat counts/],
		["^/a.*b.*c.*d.*", /unbounded quantifiers/],
		["[", /valid regular expression/],
		["a".repeat(MAX_PATH_PATTERN_LENGTH + 1), /at most 200 characters/],
	])("refuses %s", (pattern, reason) => {
		expect(pathPatternProblem(pattern)).toMatch(reason);
	});

	it("does not mistake character-class contents or escapes for structure", () => {
		expect(pathPatternProblem("^/[(+)]+")).toBeUndefined();
		expect(pathPatternProblem("^/\\(a+\\)+")).toBeUndefined();
		expect(pathPatternProblem("^/[\\]]+x")).toBeUndefined();
	});
});

describe("credits", () => {
	it("prices engines and options", () => {
		expect(creditsFor({ engine: "fetch", screenshot: false, rehostedImages: 0 })).toBe(1);
		expect(creditsFor({ engine: "proxy-fetch", screenshot: false, rehostedImages: 0 })).toBe(2);
		expect(creditsFor({ engine: "browser", screenshot: true, rehostedImages: 0 })).toBe(3);
		expect(creditsFor({ engine: "proxy-browser", screenshot: true, rehostedImages: 7 })).toBe(6);
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
		expect(discoverLinks(html, "https://docs.example.com/", { ...scope, includePaths: ["^/docs"] })).toEqual([
			"https://docs.example.com/docs/x",
		]);
		expect(discoverLinks(html, "https://docs.example.com/", { ...scope, excludePaths: ["^/blog"] })).toEqual([
			"https://docs.example.com/docs/x",
		]);
		expect(discoverLinks(html, "https://docs.example.com/", { ...scope, includePaths: ["["] })).toEqual([]);
	});

	it("treats backtracking-prone patterns like invalid ones and skips over-long links", () => {
		const html = `<a href="/docs/x">1</a><a href="/docs/${"a".repeat(MAX_CRAWL_URL_LENGTH)}">2</a>`;
		expect(discoverLinks(html, "https://docs.example.com/", { ...scope, includePaths: ["^/(a+)+$"] })).toEqual([]);
		expect(discoverLinks(html, "https://docs.example.com/", { ...scope, includePaths: ["^/docs"] })).toEqual([
			"https://docs.example.com/docs/x",
		]);
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
