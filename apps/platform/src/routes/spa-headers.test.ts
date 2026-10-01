import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Drift checks for `public/_headers`, the SPA's CSP. The policy pins the sha256 of the one
 * inline script the prerender step injects; if that script (or index.html) changes, these
 * tests fail before a deploy silently blanks every deep link.
 */

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const headersFile = read("../../public/_headers");

/** `Header: value` lines under the `/*` rule. */
const spaHeaders = (): Map<string, string> => {
	const headers = new Map<string, string>();
	let inRule = false;
	for (const line of headersFile.split("\n")) {
		if (line.startsWith("#") || line.trim() === "") {
			continue;
		}
		if (!/^\s/.test(line)) {
			inRule = line.trim() === "/*";
			continue;
		}
		if (inRule) {
			const separator = line.indexOf(":");
			headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
		}
	}
	return headers;
};

const directives = (csp: string): Map<string, string[]> =>
	new Map(
		csp
			.split(";")
			.map((part) => part.trim().split(/\s+/))
			.filter((tokens) => tokens[0])
			.map(([name, ...values]) => [name as string, values]),
	);

const sha256 = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

/** Inline, executable `<script>` bodies (JSON-LD and other data blocks are not script). */
const inlineScripts = (html: string): string[] =>
	[...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
		.filter(([, attributes = ""]) => !(/\bsrc=/.test(attributes) || /type="application\/ld\+json"/.test(attributes)))
		.map(([, , body = ""]) => body);

describe("public/_headers", () => {
	const headers = spaHeaders();
	const csp = directives(headers.get("content-security-policy") ?? "");

	it("sets the baseline security headers", () => {
		expect(headers.get("strict-transport-security")).toMatch(/max-age=\d{7,}/);
		expect(headers.get("x-frame-options")).toBe("DENY");
		expect(headers.get("x-content-type-options")).toBe("nosniff");
		expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
		expect(headers.get("permissions-policy")).toContain("camera=()");
		expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
		expect(csp.get("object-src")).toEqual(["'none'"]);
	});

	it("lets the PWA, Turnstile and the bundles load", () => {
		expect(csp.get("worker-src")).toContain("'self'");
		expect(csp.get("manifest-src")).toContain("'self'");
		expect(csp.get("script-src")).toEqual(expect.arrayContaining(["'self'", "https://challenges.cloudflare.com"]));
		expect(csp.get("frame-src")).toContain("https://challenges.cloudflare.com");
		// The Markdown preview renders the scraped page's images from their origins.
		expect(csp.get("img-src")).toEqual(expect.arrayContaining(["'self'", "data:", "https:"]));
		expect(csp.get("script-src")).not.toContain("'unsafe-inline'");
		expect(csp.get("script-src")).not.toContain("'unsafe-eval'");
	});

	it("allows exactly the inline script the prerender step injects", () => {
		const source = read("../../scripts/prerender.ts");
		const literal = /const CLEAR_SCRIPT = (`[^`]*`);/.exec(source)?.[1];
		expect(literal, "scripts/prerender.ts no longer defines CLEAR_SCRIPT as a template literal").toBeDefined();
		expect(literal).not.toContain("${");
		// Evaluate the literal exactly as the build does (escapes included).
		const html = new Function(`return ${literal};`)() as string;
		const scripts = inlineScripts(html);
		expect(scripts).toHaveLength(1);

		const allowedHashes = (csp.get("script-src") ?? []).filter((value) => value.startsWith("'sha256-"));
		expect(allowedHashes, "update the sha256 in public/_headers to match CLEAR_SCRIPT").toEqual(scripts.map(sha256));
	});

	it("has no other inline script in index.html", () => {
		expect(inlineScripts(read("../../index.html"))).toEqual([]);
	});
});
