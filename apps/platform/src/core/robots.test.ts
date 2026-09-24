import { describe, expect, it } from "vitest";

import {
	ALLOW_ALL,
	MAX_ROBOTS_TXT_BYTES,
	ROBOTS_USER_AGENT_TOKEN,
	isAllowedByRobots,
	normalizeRobotsPath,
	parseRobotsTxt,
	robotsPathOf,
	robotsTxtUrl,
	rulesFor,
} from "./robots";
import { ROBOTS_CACHE_TTL_SECONDS, ROBOTS_TIMEOUT_MS, createRobotsTxtLoader } from "./robots-fetch";

const allowed = (text: string, path: string, token?: string) => isAllowedByRobots(parseRobotsTxt(text), path, token);

describe("parseRobotsTxt", () => {
	it("groups consecutive user-agent lines and their rules", () => {
		const robots = parseRobotsTxt(
			["User-agent: a", "User-agent: b", "Disallow: /x", "", "User-agent: c", "Allow: /y"].join("\n"),
		);
		expect(robots.groups).toEqual([
			{ agents: ["a", "b"], rules: [{ allow: false, pattern: "/x" }] },
			{ agents: ["c"], rules: [{ allow: true, pattern: "/y" }] },
		]);
	});

	it("starts a new group when a user-agent line follows a rule, even without a blank line", () => {
		const robots = parseRobotsTxt("User-agent: a\nDisallow: /x\nUser-agent: b\nDisallow: /y");
		expect(robots.groups.map((group) => group.agents)).toEqual([["a"], ["b"]]);
	});

	it("keeps a group open across non-rule lines such as sitemap and crawl-delay", () => {
		const robots = parseRobotsTxt("User-agent: a\nCrawl-delay: 5\nSitemap: https://x/s.xml\nDisallow: /x");
		expect(robots.groups).toEqual([{ agents: ["a"], rules: [{ allow: false, pattern: "/x" }] }]);
	});

	it("ignores comments, blank lines, malformed lines and case in keys", () => {
		const robots = parseRobotsTxt(
			"# header\n\nUSER-AGENT: *   # everyone\nnot a directive\nDISALLOW: /private # secret\r\nallow:/private/ok",
		);
		expect(robots.groups).toEqual([
			{
				agents: ["*"],
				rules: [
					{ allow: false, pattern: "/private" },
					{ allow: true, pattern: "/private/ok" },
				],
			},
		]);
	});

	it("drops rules before any user-agent line and empty disallow values", () => {
		const robots = parseRobotsTxt("Disallow: /orphan\nUser-agent: *\nDisallow:\n");
		expect(robots.groups).toEqual([{ agents: ["*"], rules: [] }]);
		expect(allowed("Disallow: /\nUser-agent: other\nDisallow: /", "/page")).toBe(true);
	});

	it("reduces user-agent values to their product token, case-insensitively", () => {
		const robots = parseRobotsTxt("User-agent: WebforAI-Platform/0.1 (+https://webforai.dev)\nDisallow: /");
		expect(robots.groups[0]?.agents).toEqual(["webforai-platform"]);
	});

	it("ignores everything after the size cap", () => {
		const padding = `# ${"x".repeat(MAX_ROBOTS_TXT_BYTES)}\n`;
		const robots = parseRobotsTxt(`User-agent: *\nAllow: /\n${padding}Disallow: /late`);
		expect(robots.groups[0]?.rules).toEqual([{ allow: true, pattern: "/" }]);
	});
});

describe("group selection", () => {
	const text = [
		"User-agent: *",
		"Disallow: /star",
		"",
		"User-agent: webforai-platform",
		"Disallow: /ours",
		"",
		"User-agent: otherbot",
		"Disallow: /",
		"",
		"User-agent: WEBFORAI-PLATFORM",
		"Disallow: /ours-too",
	].join("\n");

	it("prefers the groups naming our token and merges them", () => {
		expect(rulesFor(parseRobotsTxt(text)).map((rule) => rule.pattern)).toEqual(["/ours", "/ours-too"]);
		expect(allowed(text, "/star")).toBe(true);
		expect(allowed(text, "/ours")).toBe(false);
		expect(allowed(text, "/ours-too/x")).toBe(false);
	});

	it("falls back to the * group when no group names our token", () => {
		const fallback = "User-agent: *\nDisallow: /star\n\nUser-agent: otherbot\nDisallow: /";
		expect(allowed(fallback, "/star/page")).toBe(false);
		expect(allowed(fallback, "/elsewhere")).toBe(true);
	});

	it("allows everything when neither our token nor * is named", () => {
		expect(allowed("User-agent: otherbot\nDisallow: /", "/anything")).toBe(true);
	});

	it("does not treat a longer token that merely starts with ours as a match", () => {
		expect(allowed("User-agent: webforai-platform-extra\nDisallow: /", "/x")).toBe(true);
	});

	it("uses the platform's product token by default", () => {
		expect(ROBOTS_USER_AGENT_TOKEN).toBe("webforai-platform");
		expect(allowed("User-agent: otherbot\nDisallow: /", "/x", "otherbot")).toBe(false);
	});
});

describe("isAllowedByRobots", () => {
	it("allows everything for an empty file and for ALLOW_ALL", () => {
		expect(allowed("", "/x")).toBe(true);
		expect(isAllowedByRobots(ALLOW_ALL, "/x")).toBe(true);
	});

	it("matches patterns as path prefixes", () => {
		const text = "User-agent: *\nDisallow: /private";
		expect(allowed(text, "/private")).toBe(false);
		expect(allowed(text, "/private/page")).toBe(false);
		expect(allowed(text, "/privately")).toBe(false);
		expect(allowed(text, "/public")).toBe(true);
		expect(allowed(text, "/")).toBe(true);
	});

	it("disallows everything with Disallow: /", () => {
		expect(allowed("User-agent: *\nDisallow: /", "/")).toBe(false);
		expect(allowed("User-agent: *\nDisallow: /", "/any/page?x=1")).toBe(false);
	});

	it("lets the longest matching pattern win", () => {
		const text = "User-agent: *\nDisallow: /docs\nAllow: /docs/public\nDisallow: /docs/public/drafts";
		expect(allowed(text, "/docs/intro")).toBe(false);
		expect(allowed(text, "/docs/public/page")).toBe(true);
		expect(allowed(text, "/docs/public/drafts/1")).toBe(false);
	});

	it("prefers allow when an allow and a disallow pattern are equally long", () => {
		expect(allowed("User-agent: *\nDisallow: /page\nAllow: /page", "/page")).toBe(true);
		expect(allowed("User-agent: *\nAllow: /page\nDisallow: /page", "/page")).toBe(true);
	});

	it("supports * wildcards anywhere in the pattern", () => {
		const text = "User-agent: *\nDisallow: /*/edit\nDisallow: /*.pdf";
		expect(allowed(text, "/wiki/edit")).toBe(false);
		expect(allowed(text, "/a/b/edit/more")).toBe(false);
		expect(allowed(text, "/edit")).toBe(true);
		expect(allowed(text, "/files/report.pdf")).toBe(false);
		expect(allowed(text, "/files/report.pdf?download=1")).toBe(false);
		expect(allowed(text, "/files/report.html")).toBe(true);
	});

	it("anchors a trailing $ at the end of the path", () => {
		const text = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /exact$";
		expect(allowed(text, "/a.pdf")).toBe(false);
		expect(allowed(text, "/a.pdf?x=1")).toBe(true);
		expect(allowed(text, "/a.pdfx")).toBe(true);
		expect(allowed(text, "/exact")).toBe(false);
		expect(allowed(text, "/exact/")).toBe(true);
	});

	it("treats a $ that is not at the end literally", () => {
		expect(allowed("User-agent: *\nDisallow: /a$b", "/a$b/c")).toBe(false);
		expect(allowed("User-agent: *\nDisallow: /a$b", "/ab")).toBe(true);
	});

	it("matches against the query string too", () => {
		const text = "User-agent: *\nDisallow: /search?q=";
		expect(allowed(text, "/search?q=term")).toBe(false);
		expect(allowed(text, "/search")).toBe(true);
	});

	it("is case-sensitive in paths", () => {
		expect(allowed("User-agent: *\nDisallow: /Private", "/private")).toBe(true);
	});

	it("always allows /robots.txt itself", () => {
		expect(allowed("User-agent: *\nDisallow: /", "/robots.txt")).toBe(true);
	});

	it("compares raw UTF-8 patterns with percent-encoded paths", () => {
		const path = robotsPathOf(new URL("https://example.com/日本語/page"));
		expect(allowed("User-agent: *\nDisallow: /日本語/", path)).toBe(false);
		expect(allowed("User-agent: *\nDisallow: /%e6%97%a5", path)).toBe(false);
	});

	it("stays fast on patterns built to backtrack", () => {
		const hostile = `User-agent: *\nDisallow: /${"*a".repeat(40)}b`;
		const start = Date.now();
		expect(allowed(hostile, `/${"a".repeat(5_000)}`)).toBe(true);
		expect(Date.now() - start).toBeLessThan(1_000);
	});
});

describe("url helpers", () => {
	it("builds the robots.txt URL from the origin", () => {
		expect(robotsTxtUrl(new URL("https://example.com:443/a/b?c=1#d"))).toBe("https://example.com/robots.txt");
		expect(robotsTxtUrl(new URL("http://sub.example.com/x"))).toBe("http://sub.example.com/robots.txt");
	});

	it("matches on path plus query, never the fragment", () => {
		expect(robotsPathOf(new URL("https://example.com/a/b?c=1#frag"))).toBe("/a/b?c=1");
		expect(robotsPathOf(new URL("https://example.com"))).toBe("/");
	});

	it("normalizes percent-escapes to upper case", () => {
		expect(normalizeRobotsPath("/a%2fb%c3%a9")).toBe("/a%2Fb%C3%A9");
		expect(normalizeRobotsPath("/é")).toBe("/%C3%A9");
	});
});

describe("createRobotsTxtLoader", () => {
	const target = new URL("https://example.com/page");
	const textResponse = (body: string, init: ResponseInit = {}) =>
		new Response(body, { status: 200, headers: { "content-type": "text/plain" }, ...init });

	it("fetches <origin>/robots.txt with the edge-cache hint, our user agent and a timeout", async () => {
		const calls: { input: string; init?: RequestInit }[] = [];
		const load = createRobotsTxtLoader((input, init) => {
			calls.push({ input, init });
			return Promise.resolve(textResponse("User-agent: *\nDisallow: /page"));
		});

		const robots = await load(target);

		expect(isAllowedByRobots(robots, "/page")).toBe(false);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.input).toBe("https://example.com/robots.txt");
		const init = calls[0]?.init as RequestInit & { cf?: unknown };
		expect(init.cf).toEqual({ cacheTtl: ROBOTS_CACHE_TTL_SECONDS, cacheEverything: true });
		expect((init.headers as Record<string, string>)["user-agent"]).toContain("webforai-platform");
		expect(init.signal).toBeInstanceOf(AbortSignal);
		expect(ROBOTS_TIMEOUT_MS).toBe(5_000);
	});

	it.each([
		["a 404", () => Promise.resolve(textResponse("User-agent: *\nDisallow: /", { status: 404 }))],
		["a 401", () => Promise.resolve(textResponse("User-agent: *\nDisallow: /", { status: 401 }))],
		["a 503", () => Promise.resolve(textResponse("User-agent: *\nDisallow: /", { status: 503 }))],
		["a network error", () => Promise.reject(new TypeError("network down"))],
		["a timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
		[
			"a non-text body",
			() =>
				Promise.resolve(
					new Response("User-agent: *\nDisallow: /", { headers: { "content-type": "application/octet-stream" } }),
				),
		],
	])("treats %s as allow-all", async (_label, fetchImpl) => {
		const robots = await createRobotsTxtLoader(fetchImpl)(target);
		expect(robots).toEqual(ALLOW_ALL);
		expect(isAllowedByRobots(robots, "/page")).toBe(true);
	});

	it("treats a redirect to a private address as allow-all", async () => {
		const response = textResponse("User-agent: *\nDisallow: /");
		Object.defineProperty(response, "url", { value: "http://127.0.0.1/robots.txt" });
		const robots = await createRobotsTxtLoader(() => Promise.resolve(response))(target);
		expect(robots).toEqual(ALLOW_ALL);
	});

	it("parses a body served without a content-type", async () => {
		const robots = await createRobotsTxtLoader(() =>
			Promise.resolve(new Response(new TextEncoder().encode("User-agent: *\nDisallow: /page"))),
		)(target);
		expect(isAllowedByRobots(robots, "/page")).toBe(false);
	});
});
