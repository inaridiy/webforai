import { defineConfig } from "vocs";
import { version } from "../packages/webforai/package.json";

// biome-ignore lint/style/noDefaultExport: This is a config file
export default defineConfig({
	title: "Webforai",
	description: "A esm-native library that converts HTML to Markdown.",
	baseUrl: "https://webforai.dev",
	logoUrl: {
		light: "/images/logo-light.png",
		dark: "/images/logo-dark.png",
	},
	iconUrl: {
		light: "/images/logo-light.png",
		dark: "/images/logo-dark.png",
	},
	editLink: {
		pattern: "https://github.com/inaridiy/webforai/edit/main/site/docs/pages/:path",
		text: "Suggest changes to this page",
	},
	theme: {
		accentColor: {
			light: "#ff9318",
			dark: "#ffc517",
		},
	},
	ogImageUrl: {
		"/": "https://webforai.dev/ogp?logo=%logo&title=%title&description=%description",
	},
	socials: [
		{
			icon: "github",
			link: "https://github.com/inaridiy/webforai",
		},
		{
			icon: "x",
			link: "https://twitter.com/inaridiy",
		},
	],
	topNav: [
		{ text: "Getting Started", link: "/getting-started" },
		{ text: "Cookbook", link: "/cookbook" },
		{
			text: version,
			items: [
				{
					text: "Releases",
					link: "https://github.com/inaridiy/webforai/releases",
				},
				{
					text: "Contributing",
					link: "https://github.com/inaridiy/webforai",
				},
			],
		},
	],
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
					text: "Custom extractor",
					link: "/cookbook/custom-extractor",
				},
				{
					text: "With Cloudflare Workers",
					link: "/cookbook/cf-workers",
				},
			],
		},
	],
});
