import { defineConfig } from "vocs";

// biome-ignore lint/style/noDefaultExport: This is a config file
export default defineConfig({
	title: "Webforai",
	sidebar: [
		{
			text: "Installation",
			link: "/installation",
		},
		{
			text: "Getting Started",
			link: "/getting-started",
		},
		{
			text: "How it works",
			link: "/how-it-works",
		},
		{
			text: "API Reference",
			items: [
				{
					text: "htmlToMarkdown",
					link: "/api/html-to-markdown",
				},
				{
					text: "htmlToMdast",
					link: "/api/html-to-mdast",
				},
				{
					text: "mdastToMarkdown",
					link: "/api/mdast-to-markdown",
				},
				{
					text: "loaders",
					link: "/api/loaders",
				},
			],
		},
		{
			text: "Cookbook",
			link: "/cookbook",

			items: [
				{
					text: "Simple usage",
					link: "/cookbook/simple",
				},
				{
					text: "Structured output",
					link: "/cookbook/structured-output",
				},
				{
					text: "Translation",
					link: "/cookbook/translation",
				},
				{
					text: "With Cloudflare Workers",
					link: "/cookbook/cf-workers",
				},
			],
		},
	],
});
