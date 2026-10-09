import { describe, expect, it } from "vitest";
import { renderLlmsFullTxt, renderLlmsTxt } from "./llms-txt";

const site = {
	seedUrl: "https://docs.example.com/",
	pages: [
		{
			url: "https://docs.example.com/guide/install",
			markdown: "# Install\n\nRun it.",
			metadata: { title: "Install [beta]", description: "How to install." },
		},
		{
			url: "https://docs.example.com/",
			markdown: "# Example Docs\n\nWelcome.",
			metadata: { title: "Home", siteName: "Example Docs", description: "Docs for   Example." },
		},
		{ url: "https://docs.example.com/api/client", markdown: "No heading here.", metadata: {} },
		{ url: "https://docs.example.com/guide/", markdown: "## Guide\n\nStart.", metadata: {} },
	],
};

describe("renderLlmsTxt", () => {
	it("follows the llmstxt.org shape: H1, summary quote, H2 sections of link lists", () => {
		expect(renderLlmsTxt(site)).toBe(
			[
				"# Example Docs",
				"",
				"> Docs for Example.",
				"",
				"## Pages",
				"",
				"- [Home](https://docs.example.com/): Docs for Example.",
				"",
				"## Api",
				"",
				"- [/api/client](https://docs.example.com/api/client)",
				"",
				"## Guide",
				"",
				"- [Guide](https://docs.example.com/guide/)",
				"- [Install \\[beta\\]](https://docs.example.com/guide/install): How to install.",
				"",
			].join("\n"),
		);
	});

	it("falls back to the host when no page names the site", () => {
		const text = renderLlmsTxt({
			seedUrl: "https://x.example/start",
			pages: [{ url: "https://x.example/a", markdown: "", metadata: {} }],
		});
		expect(text.startsWith("# x.example\n\n## Pages\n")).toBe(true);
	});
});

describe("renderLlmsFullTxt", () => {
	it("concatenates every page in index order with its source URL", () => {
		const text = renderLlmsFullTxt(site);
		const order = ["https://docs.example.com/\n", "/api/client\n", "/guide/\n", "/guide/install\n"].map((needle) =>
			text.indexOf(`Source: ${needle.startsWith("/") ? `https://docs.example.com${needle}` : needle}`),
		);
		expect(order.every((index) => index > 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(text).toContain("# /api/client\n\nSource: https://docs.example.com/api/client\n\nNo heading here.");
		expect(text.split("\n---\n")).toHaveLength(5);
	});
});
